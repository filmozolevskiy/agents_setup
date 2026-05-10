"""
Playwright browser + context factory used by every runner.

Key behaviour:
- Blocks third-party scripts and document navigations (ClickTripz, TripAdvisor,
  hotel ad networks, etc.) that would otherwise hijack the search form submit.
  First-party XHR/JS from flighthub.com and justfly.com passes through.
- Opens Playwright trace when QA_TRACE=1 (default on) and saves it to
  ``{scenario_dir}/trace.zip`` in ``close_context``.

Use as a context manager::

    with launch_browser() as browser:
        with launch_context(browser, scenario_dir) as ctx:
            page = ctx.new_page()
            ...
"""
from __future__ import annotations

import contextlib
import os
from pathlib import Path
from typing import Iterator
from urllib.parse import urlparse

from playwright.sync_api import Browser, BrowserContext, Playwright, sync_playwright

FIRST_PARTY_HOST_SUFFIXES: tuple[str, ...] = (
    "flighthub.com",
    "justfly.com",
    "voyagesalacarte.ca",
)

# Third-party hosts whose scripts the page genuinely needs to mount the
# payment stage on production. Without these the storefront throws
# ``ReferenceError: braintree is not defined`` and ``#submit_booking``
# never gets rendered (manifests as ``checkout_render_timeout``):
#
#   * ``braintreegateway.com`` — Braintree client SDK + PayPal Checkout
#     SDK. Hard requirement: ``Mv.AlternatePaymentMethods.PayPalCheckoutPaymentMethod.createPaypalSdkClient``
#     calls ``braintree.client.create()`` directly.
#   * ``paypalobjects.com`` — PayPal CDN (``checkout.js`` + image
#     assets); referenced by the PayPal SDK after Braintree initialises.
#   * ``evervault.com`` — Evervault card-data encryption widget. Used
#     by the storefront to tokenize the PAN before submit.
#   * ``riskified.com`` — Riskified fraud-detection beacon. The
#     storefront waits for it to fingerprint the session before
#     enabling submit on certain card BIN ranges.
#   * ``affirm.com`` / ``affirm.ca`` — Affirm BNPL. The payment-method
#     registration loop iterates every supported method; a missing
#     Affirm SDK leaves the registration loop in a bad state and
#     blocks the rest of the methods (same code path as Braintree).
PAYMENT_HOST_SUFFIXES: tuple[str, ...] = (
    "braintreegateway.com",
    "paypalobjects.com",
    "paypal.com",
    "evervault.com",
    "riskified.com",
    "affirm.com",
    "affirm.ca",
)

ALLOWED_HOST_SUFFIXES: tuple[str, ...] = FIRST_PARTY_HOST_SUFFIXES + PAYMENT_HOST_SUFFIXES


def _is_allowed(url: str) -> bool:
    """Allowlist check: first-party flighthub/justfly hosts plus the
    payment-services third-parties the storefront cannot run without.
    """
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return True
    if not host:
        return True
    return any(host == s or host.endswith("." + s) for s in ALLOWED_HOST_SUFFIXES)


# Backwards-compatible alias — older call sites referenced ``_is_first_party``.
_is_first_party = _is_allowed


def _route_blocker(route) -> None:
    """Playwright route handler: block third-party scripts + document
    navigations *except* the payment-services SDKs that the page
    genuinely needs to mount.

    Without this guard, the homepage search-form submit can be hijacked
    by hotel-ad networks (ClickTripz / TripAdvisor) and the main tab
    never lands on ``/flight/search``. Without the payment-services
    carve-out, the production checkout page can't load Braintree /
    PayPal / Evervault / Riskified, throws
    ``ReferenceError: braintree is not defined`` mid-mount, and the
    payment stage never renders ``#submit_booking`` (surfaces as
    ``checkout_render_timeout``).
    """
    request = route.request
    if _is_allowed(request.url):
        return route.continue_()
    if request.resource_type in {"script", "document"}:
        return route.abort()
    return route.continue_()


@contextlib.contextmanager
def launch_browser(headless: bool | None = None) -> Iterator[tuple[Playwright, Browser]]:
    """Context manager that yields (playwright, browser). Cleans both up on exit."""
    if headless is None:
        headless = os.environ.get("QA_HEADLESS", "1") != "0"
    pw = sync_playwright().start()
    try:
        browser = pw.chromium.launch(headless=headless)
        try:
            yield pw, browser
        finally:
            browser.close()
    finally:
        pw.stop()


@contextlib.contextmanager
def launch_context(
    browser: Browser,
    scenario_dir: Path,
    *,
    viewport: tuple[int, int] = (1400, 900),
    user_agent: str | None = None,
    trace: bool | None = None,
) -> Iterator[BrowserContext]:
    """Yield a fresh BrowserContext with route blocker + optional tracing."""
    if trace is None:
        trace = os.environ.get("QA_TRACE", "1") != "0"

    if user_agent is None:
        user_agent = os.environ.get("QA_USER_AGENT") or None

    context = browser.new_context(
        viewport={"width": viewport[0], "height": viewport[1]},
        user_agent=user_agent,
    )
    context.route("**/*", _route_blocker)

    if trace:
        context.tracing.start(screenshots=True, snapshots=True, sources=True)

    try:
        yield context
    finally:
        if trace:
            scenario_dir.mkdir(parents=True, exist_ok=True)
            try:
                context.tracing.stop(path=str(scenario_dir / "trace.zip"))
            except Exception:
                pass
        context.close()
