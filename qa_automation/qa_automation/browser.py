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


def _is_first_party(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return True
    if not host:
        return True
    return any(host == s or host.endswith("." + s) for s in FIRST_PARTY_HOST_SUFFIXES)


def _route_blocker(route) -> None:
    """Playwright route handler: block third-party scripts + document navigations.

    Without this, the search form submit redirects the main tab to hotel ad
    networks instead of /flight/search.
    """
    request = route.request
    if _is_first_party(request.url):
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
