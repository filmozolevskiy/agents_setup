"""
qa-book: open an existing /flight/search URL, pick a package (by content
source or index), checkout with autofill, wait for confirmation, resolve
booking_id + debug_transaction_id via MySQL.

Input comes from the previous ``qa-search`` call. Stateless — the runner
re-navigates to the search URL and lets results re-load.

The runner is environment-aware:

  * On **staging** (``staging<N>.flighthub.com``), the booking flow can
    end either in confirmation (autofill cards are gateway-faked) or in
    a controlled failure if you pass ``--booking-failure-reason``.
  * On **production** (``www.flighthub.com``), the runner *defaults* to
    injecting a ``CC Decline`` failure via the Debugging Options panel
    so the card is never actually charged. To run a real production
    booking against the supplier, pass
    ``--booking-failure-reason none --i-know-this-charges-real-money``;
    the platform's own protections (test-card detection / CC decline)
    are still in effect, but the runner is no longer the safety net.

Env detection order: ``--env`` flag (if given) → host of ``--search-url``
(``staging*`` → staging, anything else → production).
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import NoReturn
from urllib.parse import urlparse

from qa_automation.browser import launch_browser, launch_context
from qa_automation.db.queries import (
    debug_logs_count,
    diagnose_booker_failure,
    jupiter_booking_errors_compact,
    resolve_booking,
    resolve_booking_by_transaction_id,
)
from qa_automation.network import capture_storefront_transaction_id
from qa_automation.pages.base_page import SelectorNotFound
from qa_automation.pages.checkout_page import CheckoutPage
from qa_automation.pages.confirmation_page import ConfirmationPage
from qa_automation.pages.results_page import ResultsPage
from qa_automation.runners._common import (
    allocate_scenario_dir,
    die_from_exception,
    emit_error,
    emit_ok,
    list_screenshots,
    load_env,
)
from qa_automation.utils.env import Env, env_from_url

logger = logging.getLogger(__name__)

# Production-default failure reason injected via the Debugging Options panel.
# Picked because it is the cleanest *no-supplier-impact* failure: the booker
# short-circuits before calling the GDS, the card never reaches the payment
# gateway, and ``ota.bookings.process_status`` lands on a clean
# ``BOOKING_FAILED`` row. Other allowed labels: ``Fraud``, ``Fare Increase``,
# ``Flight Not Available``, ``CC 3DS Failed``, ``Issue with this card``.
PROD_DEFAULT_FAILURE_REASON = "CC Decline"

# Sentinel meaning "do not inject any failure". Lower-cased so the label
# match in CheckoutPage.set_booking_failure_reason is case-insensitive.
NO_FAILURE_INJECTION = "none"


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qa-book",
        description="Pick a package on a results page, checkout, and confirm a test booking.",
    )
    p.add_argument("--search-url", required=True, help="URL from qa-search output")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--content-source", help="e.g. amadeus, tripstack, kiwi")
    src.add_argument("--package-index", type=int, help="0-based index into results (any source)")
    p.add_argument("--scenario-dir", default=None, help="Reuse a dir from qa-search for co-located screenshots")
    p.add_argument("--label", default=None, help="Label for a new scenario dir if --scenario-dir omitted")
    p.add_argument("--cc-number", default=None)
    p.add_argument("--cc-expiry", default=None)
    p.add_argument("--cc-cvv", default=None)
    p.add_argument("--cc-name", default=None)
    p.add_argument(
        "--env",
        choices=["staging", "production"],
        default=None,
        help=(
            "Override env detection. Default: derive from --search-url host "
            "(staging* -> staging, else -> production)."
        ),
    )
    p.add_argument(
        "--booking-failure-reason",
        default=None,
        help=(
            "Inject a controlled failure via the Debugging Options panel "
            "before submit. Pass the visible label (e.g. 'CC Decline', "
            "'Fraud', 'Fare Increase', 'Flight Not Available'), or 'none' "
            "to skip injection. Default: 'CC Decline' on production "
            "(safe), 'none' on staging."
        ),
    )
    p.add_argument(
        "--i-know-this-charges-real-money",
        action="store_true",
        dest="ack_real_money",
        help=(
            "Required to run on production with --booking-failure-reason "
            "none. Acknowledges that the platform's protection mechanisms "
            "(test-card detection, CC decline at the gateway) are now the "
            "only safety net."
        ),
    )
    return p


def _confirmation_portal_url(search_url: str, id_hash: str) -> str:
    """Strip query and path from the search URL and build the portal URL prefix."""
    from urllib.parse import urlparse
    u = urlparse(search_url)
    return f"{u.scheme}://{u.netloc}/service/portal/detail/{id_hash}"


def _extract_transaction_id(checkout_url: str) -> str | None:
    """Extract the transaction_id from a checkout URL.

    The staging checkout URL has the shape::

        /checkout/billing/flight/{transaction_id}/{package_id}/...

    where ``transaction_id`` is the same value used as ``search_id`` in
    storefront search and as ``transaction_id`` on ``debug_logs`` /
    ``debug_transaction_id`` on ``ota.bookings``. We rely on this collapse
    to pivot from a stuck checkout into Mongo + MySQL diagnostics.
    """
    from urllib.parse import urlparse
    parts = [p for p in urlparse(checkout_url).path.split("/") if p]
    try:
        i = parts.index("flight")
    except ValueError:
        return None
    if i + 1 >= len(parts):
        return None
    candidate = parts[i + 1]
    # Sanity: lowercase hex, 32 chars (md5-style hash used across staging).
    if len(candidate) == 32 and all(
        c in "0123456789abcdef" for c in candidate
    ):
        return candidate
    return None


# Map ``classification_category`` from ``jupiter.jupiter_booking_errors_v2``
# (and exception class as a fallback for the Mongo-only path) into a coarse
# attribution of *who* failed:
#
#   - ``supplier``: GDS / consolidator returned a real availability or system
#     error. Retry path is to refresh inventory and pick another package.
#   - ``payment_processor``: Payhub / our payment gateway pipeline rejected
#     the card or VCC. Not the airline.
#   - ``our_pricing_guard``: our own loss-limit / fare-increase / pricing
#     discrepancy guard tripped. The supplier was happy to sell at a price we
#     refused to accept. Retry the same package only if the price comes back
#     in range.
#   - ``unknown``: technical error, unmapped class, or no signal at all.
#
# Keep this conservative — anything we can't cleanly bucket stays ``unknown``.
_FAILURE_ORIGIN_BY_CATEGORY = {
    "FLIGHT_AVAILABILITY_ERRORS": "supplier",
    "CONTENT_SOURCE_ERRORS": "supplier",
    "PAYMENT_ERRORS": "payment_processor",
    "FARE_INCREASES": "our_pricing_guard",
    "PRICING_DISCREPANCY_ERRORS": "our_pricing_guard",
    "TECHNICAL_ERRORS": "unknown",
}


def _classify_failure_origin(
    classification_category: str | None,
    exception_class: str | None,
) -> str:
    if classification_category and classification_category in _FAILURE_ORIGIN_BY_CATEGORY:
        return _FAILURE_ORIGIN_BY_CATEGORY[classification_category]
    # Fallback: only Mongo evidence is available. Pattern-match the
    # exception class string — these are the high-volume buckets we know.
    if exception_class:
        ec = exception_class
        if "FlightNotAvailable" in ec or "GdsError" in ec or "SegmentNotAvailable" in ec:
            return "supplier"
        if "Payhub" in ec or "PaymentDeclined" in ec or "Payment" in ec:
            return "payment_processor"
        if "FareIncrease" in ec or "LossLimit" in ec or "PricingError" in ec or "PriceChange" in ec:
            return "our_pricing_guard"
    return "unknown"


def _build_retry_hint(
    *,
    failure_origin: str,
    booker_label: str | None,
    error_token: str,
    booking_step: str | None,
) -> str:
    booker = booker_label or "booker"
    step = f" during {booking_step}" if booking_step else ""
    if failure_origin == "supplier":
        return (
            f"supplier {booker} returned {error_token}{step}. Bookability "
            "drift between search and book — re-run qa-search to refresh "
            "inventory and try another package, or wait 1-5 minutes and "
            "retry the same route."
        )
    if failure_origin == "payment_processor":
        return (
            f"our payment processor rejected the booking ({error_token}){step}. "
            "This is on our side, not the supplier — try a different test card "
            "via --cc-number, or check Payhub status before retrying."
        )
    if failure_origin == "our_pricing_guard":
        return (
            f"our pricing/loss-limit guard tripped ({error_token}){step}. "
            "The supplier was willing to sell, but the price drifted past our "
            "internal threshold. Re-run qa-search to refresh pricing or pick "
            "another package."
        )
    return (
        f"booker pipeline returned {error_token}{step}. Origin not "
        "auto-classified — inspect clickhouse_errors and booker_diagnosis "
        "in this body for context, or re-run qa-search and try another package."
    )


def _diagnose_post_submit_failure(
    *,
    page_url: str,
    scenario_dir: Path,
    search_url: str,
    content_source: str | None,
    package_index: int | None,
    price_amount: float | None,
    price_currency: str | None,
    cause: BaseException,
    qa_env: Env,
    booking_failure_reason: str | None,
    failure_injection_banner: dict | None = None,
) -> NoReturn:
    """Translate a stuck post-submit checkout into an actionable error JSON.

    Pivots on ``transaction_id`` extracted from the checkout URL:
      1. ClickHouse ``jupiter.jupiter_booking_errors_v2`` — the canonical,
         structured booking-error feed used by ops. Has GDS / route /
         pax shape / ``main_group_error`` / ``front_end_message`` and
         ``classification_category`` in a single row.
      2. MongoDB ``debug_logs`` booker-exception probe — enriches with
         exception class + stack frame for cases CK can't classify yet.
      3. Look up ``ota.bookings`` by ``debug_transaction_id`` — sometimes
         the booking IS made but the browser never navigated to the
         portal URL.
      4. Otherwise emit ``confirmation_url_timeout`` with whatever
         context we have (CK row count, debug_logs count) so the agent
         can decide whether to wait and re-poll or retry.

    A booker-pipeline failure (case 1/2) emits ``booking_failed_in_pipeline``
    with a ``failure_origin`` field — ``supplier`` /
    ``payment_processor`` / ``our_pricing_guard`` / ``unknown`` —
    derived from CK ``classification_category`` (see
    ``_classify_failure_origin``). Roughly half of all rows in
    ``jupiter_booking_errors_v2`` are *our* guards firing
    (loss-limit, payment processor), not the supplier, so do **not**
    rename this back to ``booking_failed_at_supplier``.
    """
    txn_id = _extract_transaction_id(page_url)
    common: dict[str, object] = {
        "scenario_dir": scenario_dir,
        "screenshots": list_screenshots(scenario_dir),
        "checkout_url": page_url,
        "search_url": search_url,
        "transaction_id": txn_id,
        "content_source_requested": content_source,
        "package_index_requested": package_index,
        "currency_shown_at_checkout": price_currency,
        "total_shown_at_checkout": price_amount,
        "env": qa_env.value,
        "booking_failure_reason_injected": booking_failure_reason,
    }

    # 0. Booker-injected failure banner — short-circuit before paying for
    #    DB lookups. When ``--booking-failure-reason`` was honoured the
    #    booker re-renders the payment stage with the matching alert
    #    ("Credit Card check failed", etc.) and never persists a row.
    #    Surfacing this as ``booking_failed_by_injection`` makes the
    #    production safety-rail outcome trivially recognisable.
    if failure_injection_banner is not None and booking_failure_reason is not None:
        emit_error(
            "booking_failed_by_injection",
            detail=(
                f"Booker honoured the injected '{booking_failure_reason}' "
                "failure: the payment stage re-rendered with the matching "
                "user-facing alert and never persisted an ota.bookings row. "
                "No supplier was contacted, no card was charged."
            ),
            retry_hint=(
                "this is the expected outcome of the production safety "
                "rail — pass --booking-failure-reason none "
                "--i-know-this-charges-real-money to attempt a real "
                "booking against the supplier."
            ),
            failure_origin="qa_injection",
            front_end_message=failure_injection_banner.get("text"),
            front_end_markers=failure_injection_banner.get("markers"),
            **common,
        )

    if txn_id is None:
        emit_error(
            "confirmation_url_timeout",
            detail=(
                "Submit clicked but neither portal URL nor a parseable "
                "transaction_id is available. Likely a client-side validation "
                "failure on the payment stage."
            ),
            cause=str(cause),
            **common,
        )

    # 1. ClickHouse jupiter_booking_errors_v2 — primary supplier-side signal.
    try:
        ck_errors = jupiter_booking_errors_compact(txn_id)
    except Exception as exc:
        ck_errors = []
        common["clickhouse_lookup_error"] = repr(exc)

    # 2. MongoDB booker-exception probe — enrichment / coverage when CK lags.
    try:
        diagnosis = diagnose_booker_failure(txn_id)
    except Exception as exc:
        diagnosis = None
        common["mongo_diagnosis_error"] = repr(exc)

    if ck_errors or (diagnosis and diagnosis.get("exception_class")):
        # Prefer CK fields for the headline (structured + ops-canonical);
        # fall back to Mongo diagnosis when CK hasn't ingested yet.
        primary = ck_errors[0] if ck_errors else None
        classification = (
            primary.get("classification_category") if primary else None
        )
        exception_class = (
            (diagnosis or {}).get("exception_class")
            or (primary or {}).get("main_group_error")
        )
        failure_origin = _classify_failure_origin(
            classification, exception_class
        )
        if primary is not None:
            headline = (
                primary.get("error_message")
                or primary.get("main_group_error")
                or "booking pipeline returned an error"
            )
            booker_label = primary.get("gds") or (
                diagnosis.get("booker") if diagnosis else None
            )
            retry_hint = _build_retry_hint(
                failure_origin=failure_origin,
                booker_label=booker_label,
                error_token=str(
                    primary.get("main_group_error") or headline
                ),
                booking_step=primary.get("booking_step"),
            )
        else:
            headline = str(diagnosis.get("exception_message") or cause)
            booker_label = diagnosis.get("booker")
            retry_hint = _build_retry_hint(
                failure_origin=failure_origin,
                booker_label=booker_label,
                error_token=str(diagnosis.get("exception_class")),
                booking_step=None,
            )
        extra: dict[str, object] = {"failure_origin": failure_origin}
        if classification is not None:
            extra["classification_category"] = classification
        if primary is not None and primary.get("front_end_message"):
            extra["front_end_message"] = primary.get("front_end_message")
        emit_error(
            "booking_failed_in_pipeline",
            detail=str(headline),
            clickhouse_errors=ck_errors,
            booker_diagnosis=diagnosis,
            retry_hint=retry_hint,
            **extra,
            **common,
        )

    # 3. MySQL fallback — booking may have succeeded silently.
    try:
        booking = resolve_booking_by_transaction_id(txn_id)
    except Exception as exc:
        booking = None
        common["mysql_lookup_error"] = repr(exc)

    if booking and booking.get("is_test"):
        # Booking row exists for our txn — surface it; the agent can call
        # qa-validate / qa-cleanup with the id_hash without needing the
        # confirmation URL to have rendered.
        emit_error(
            "confirmation_url_timeout_but_booking_created",
            detail=(
                "Submit succeeded server-side: ota.bookings row exists for "
                "this transaction_id but the browser never navigated to the "
                "portal URL within the timeout. Booking is real and may need "
                "cleanup."
            ),
            retry_hint=(
                "use the returned id_hash with qa-validate / qa-cleanup; "
                "no need to re-submit"
            ),
            booking_id=booking.get("id"),
            id_hash=booking.get("id_hash"),
            booking_status=booking.get("status"),
            checkout_status=booking.get("checkout_status"),
            process_status=booking.get("process_status"),
            booking_date=booking.get("booking_date"),
            **common,
        )

    # 4. Generic timeout — include both CK error count and debug_logs count
    #    so the agent can decide whether to wait or move on.
    try:
        log_count = debug_logs_count(txn_id)
    except Exception:
        log_count = None

    emit_error(
        "confirmation_url_timeout",
        detail=str(cause),
        retry_hint=(
            "no booker exception logged yet; either submit click did not "
            "fire, payment is still in flight, or backend rejected before "
            "reaching the booker. Inspect after-submit-*s screenshots in "
            "scenario_dir, or re-run qa-validate by transaction_id once "
            "logs settle."
        ),
        clickhouse_errors_count=len(ck_errors),
        debug_logs_count=log_count,
        **common,
    )


def _resolve_env(args: argparse.Namespace) -> Env:
    """Pick env from explicit flag, else infer from --search-url host."""
    if args.env:
        return Env(args.env)
    return env_from_url(args.search_url)


def _resolve_failure_reason(
    args: argparse.Namespace,
    qa_env: Env,
    scenario_dir: Path,
) -> str | None:
    """Resolve the requested ``--booking-failure-reason`` for this run.

    Returns the (label-cased) reason to inject, or ``None`` for no injection.
    Enforces the production safety rail:
      * Default on prod is ``PROD_DEFAULT_FAILURE_REASON`` (``CC Decline``).
      * Setting ``--booking-failure-reason none`` on prod requires
        ``--i-know-this-charges-real-money`` — without it the runner
        emits ``production_safety_rail`` and exits non-zero.
    """
    explicit = args.booking_failure_reason
    if qa_env == Env.PRODUCTION:
        reason = explicit if explicit is not None else PROD_DEFAULT_FAILURE_REASON
        if reason.lower() == NO_FAILURE_INJECTION:
            if not args.ack_real_money:
                emit_error(
                    "production_safety_rail",
                    detail=(
                        "Refusing to submit a booking on production without "
                        "a controlled-failure injection. Pass "
                        "--i-know-this-charges-real-money to acknowledge "
                        "that the platform's own protections (test-card "
                        "detection, CC decline at the gateway) are now the "
                        "only safety net, or pass --booking-failure-reason "
                        "with a non-'none' label like 'CC Decline'."
                    ),
                    env="production",
                    scenario_dir=scenario_dir,
                    screenshots=list_screenshots(scenario_dir),
                )
            return None
        return reason
    if explicit is None or explicit.lower() == NO_FAILURE_INJECTION:
        return None
    return explicit


def _log_run_summary(
    *,
    qa_env: Env,
    args: argparse.Namespace,
    failure_reason: str | None,
    card_override: tuple[str, str, str, str] | None,
) -> None:
    """Emit a single human-friendly run-summary block to stderr.

    This is the *audit trail* a human or another agent reads to confirm
    "yes, we are about to submit on production with a CC Decline
    injection". It includes the full resolved card details (autofill or
    override) — keep it on stderr so the JSON on stdout stays parseable
    and we don't leak the card into a piped JSON file.
    """
    host = (urlparse(args.search_url).hostname or "<unknown>").lower()
    sys.stderr.write("=" * 78 + "\n")
    sys.stderr.write(f"qa-book run summary  env={qa_env.value}  host={host}\n")
    sys.stderr.write(
        f"  search_url            = {args.search_url}\n"
        f"  content_source        = {args.content_source!r}\n"
        f"  package_index         = {args.package_index!r}\n"
        f"  booking_failure_reason= {failure_reason!r}  "
        f"({'INJECT FAILURE' if failure_reason else 'NO injection — booking will go through'})\n"
        f"  ack_real_money        = {args.ack_real_money}\n"
    )
    if card_override is not None:
        n, e, c, name = card_override
        masked = f"{n[:4]}…{n[-4:]}" if len(n) > 8 else n
        sys.stderr.write(
            f"  card_override         = number={masked} expiry={e} cvv=*** name={name!r}\n"
        )
    else:
        sys.stderr.write(
            "  card_override         = (none — relies on autofill card)\n"
        )
    sys.stderr.write("=" * 78 + "\n")
    sys.stderr.flush()


def main() -> None:
    load_env()
    args = _build_arg_parser().parse_args()

    scenario_dir = allocate_scenario_dir(
        args.label or "book",
        existing=args.scenario_dir,
    )

    card_override = None
    if any([args.cc_number, args.cc_expiry, args.cc_cvv, args.cc_name]):
        if not all([args.cc_number, args.cc_expiry, args.cc_cvv, args.cc_name]):
            die_from_exception(
                ValueError("partial --cc-* flags: pass all four (number/expiry/cvv/name) or none"),
                scenario_dir=scenario_dir,
            )
        card_override = (args.cc_number, args.cc_expiry, args.cc_cvv, args.cc_name)

    qa_env = _resolve_env(args)
    failure_reason = _resolve_failure_reason(args, qa_env, scenario_dir)
    # Sync QA_ENV for downstream callers (resolve_url, ResPro cleanup, etc.)
    # so they see the same env we resolved here even if the user passed
    # ``--env`` or relied on URL inference.
    os.environ["QA_ENV"] = qa_env.value
    _log_run_summary(
        qa_env=qa_env,
        args=args,
        failure_reason=failure_reason,
        card_override=card_override,
    )

    try:
        with launch_browser() as (_, browser):
            with launch_context(browser, scenario_dir) as context:
                page = context.new_page()
                tx_capture = capture_storefront_transaction_id(page)

                page.goto(args.search_url, wait_until="domcontentloaded")

                results = ResultsPage(page, scenario_dir)
                results.wait_for_results()

                if args.content_source is not None:
                    results.select_package_by_source(args.content_source, package_index=0)
                else:
                    results.select_first_package(package_index=args.package_index)

                checkout = CheckoutPage(page, scenario_dir)
                checkout.wait_for_load()
                checkout.autofill()
                # Decline insurance (travel + baggage), pin the optimizer,
                # and inject a controlled failure (production-default) while
                # still on stage 1 of the checkout — all three controls live
                # above/below the "Continue to payment" CTA on two-stage
                # flows, and are required to unblock stage advance.
                checkout.decline_insurance()
                if args.content_source is not None:
                    checkout.disable_optimizer()
                if failure_reason is not None:
                    checkout.set_booking_failure_reason(failure_reason)
                # No-op on single-stage checkouts; advances to the payment
                # form on two-stage (LCC/consolidator) checkouts.
                checkout.advance_to_payment_if_needed()

                if card_override is not None:
                    checkout.override_card(*card_override)

                price_amount, price_currency = checkout.get_price_summary()

                checkout.submit()

                confirmation = ConfirmationPage(page, scenario_dir)
                # If the confirmation portal URL never loads, pivot to
                # MongoDB debug_logs (booker exception) and MySQL bookings
                # (silent success) for an actionable diagnosis instead of
                # bailing with a generic selector_not_found.
                try:
                    confirmation.wait_for_confirmation()
                except SelectorNotFound as exc:
                    if exc.name != "confirmation.url":
                        raise
                    # If we injected a failure reason, look for the
                    # booker's user-facing alert before paying for
                    # CK / Mongo / MySQL lookups — it is the cleanest
                    # signal that the safety rail did its job.
                    injection_banner: dict | None = None
                    if failure_reason is not None:
                        try:
                            injection_banner = (
                                checkout.detect_failure_injection_banner()
                            )
                        except Exception:
                            injection_banner = None
                    _diagnose_post_submit_failure(
                        page_url=page.url,
                        scenario_dir=scenario_dir,
                        search_url=args.search_url,
                        content_source=args.content_source,
                        package_index=args.package_index,
                        price_amount=price_amount,
                        price_currency=price_currency,
                        cause=exc,
                        qa_env=qa_env,
                        booking_failure_reason=failure_reason,
                        failure_injection_banner=injection_banner,
                    )
                id_hash = confirmation.id_hash
                confirmation.dismiss_post_booking_upsell()

                # Resolve booking_id + debug_transaction_id via MySQL.
                booking = resolve_booking(booking_id=None, id_hash=id_hash)
                if booking is None:
                    die_from_exception(
                        RuntimeError(
                            f"ota.bookings row not found for id_hash={id_hash!r} "
                            "— confirmation landed but DB write not yet visible. "
                            "Retry `qa-validate --id-hash ...` in a few seconds."
                        ),
                        scenario_dir=scenario_dir,
                    )

                emit_ok({
                    "scenario_dir": scenario_dir,
                    "env": qa_env.value,
                    "id_hash": id_hash,
                    "booking_id": booking.get("id"),
                    "debug_transaction_id": booking.get("debug_transaction_id")
                    or tx_capture.value,
                    "portal_url": _confirmation_portal_url(args.search_url, id_hash),
                    "content_source_booked": args.content_source,
                    "package_index_booked": args.package_index,
                    "booking_failure_reason_injected": failure_reason,
                    "currency_shown_at_checkout": price_currency,
                    "total_shown_at_checkout": price_amount,
                    "bookings_row": booking,
                    "screenshots": list_screenshots(scenario_dir),
                })
    except SystemExit:
        raise
    except BaseException as exc:
        die_from_exception(exc, scenario_dir=scenario_dir)


if __name__ == "__main__":
    main()
