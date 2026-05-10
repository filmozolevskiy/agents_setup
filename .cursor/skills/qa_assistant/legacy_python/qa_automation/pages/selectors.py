"""
Single source of truth for every CSS/text selector used by page objects.

When staging front-end deploys break a selector, update it here. Pages import
from this module; no selector constants live anywhere else.

Selectors are written as **unions** that match both staging
(``staging2.flighthub.com`` / ``staging2.justfly.com``) and production
(``www.flighthub.com`` / ``www.justfly.com``) wherever the two surfaces
diverge cosmetically. Where the underlying flow differs, the divergence
lives in the page-object logic, not the selector string. As of
``VERIFIED_ON``, the Debug Filters panel (``select#gds`` + the
Debugging Options block on checkout) is present on **both** envs;
the per-package "Show Info" reveal is the prod-side fallback for
content-source pinning if a future deploy ever drops the dropdown.
``VERIFIED_ON`` is the date both envs were last confirmed.
"""
from __future__ import annotations

from dataclasses import dataclass, fields

VERIFIED_ON = "2026-04-26 (staging2 + production)"


@dataclass(frozen=True)
class SearchSelectors:
    form: str = "form.flight-search-form"
    trip_type_template: str = "div.trip-type-{trip_type}"

    origin_wrapper: str = "div.search-form-input.departure"
    origin_input: str = "#seg0_from_display"
    dest_input: str = "#seg0_to_display"

    date_input: str = "#seg0_date"
    datepicker_next: str = ".rdrNextButton"
    day_cell: str = ".rdrDay:not(.rdrDayDisabled):not(.rdrDayPassive)"
    datepicker_done: str = "button:has-text('Set dates'), button:has-text('Done')"

    submit_btn: str = "div.home-search-form-submit"

    pax_wrapper: str = ".passenger-input-wrapper"
    pax_adt_plus: str = '.dropdown-item:has-text("Adult (12+)") .plus-minus:last-child'
    pax_chd_plus: str = '.dropdown-item:has-text("Child (2-11)") .plus-minus:last-child'
    pax_inf_lap_plus: str = '.dropdown-item:has-text("Infant on lap") .plus-minus:last-child'
    pax_close: str = "button.landing-cta-btn"


@dataclass(frozen=True)
class ResultsSelectors:
    # Staging renders Select as a <button>; production renders it as an
    # <a> styled like a button. Match both — the click semantics are
    # identical and Playwright's text engine doesn't care.
    select_btn: str = 'button:has-text("Select"), a:has-text("Select")'
    # Staging exposes a class on the dismiss CTA; production uses an
    # anchor with the visible text only. Match both.
    bundle_dismiss_btn: str = (
        '.continue-with-flight-only-btn, a:has-text("Continue with flight only")'
    )
    fare_loading: str = "text=Fetching fare information"
    # Staging advances inline ("Continue to checkout"); production opens a
    # fare-family modal that ends in a "Checkout" button. Either CTA
    # advances the flow to /checkout/billing/flight/.
    continue_to_checkout: str = (
        'button:has-text("Continue to checkout"), '
        'button:has-text("Checkout"):not(:has-text("Continue"))'
    )

    # Debug Filters panel — dropdown filter that re-runs the search
    # against a single content source. Verified on **both staging and
    # production** as of 2026-04-26. Used as the primary content-source
    # pinning path; the "Show Info" fallback below is only triggered
    # when this panel is absent (older builds or future refactors).
    debug_filter_toggle: str = ".debug-filters-header-toggle"
    gds_select: str = "select#gds"
    # Per-package debug surface: clicking the toggle reveals an inline
    # ``gds => <source>`` info panel for every result card. Present on
    # production (and recent staging deploys); used by
    # ``ResultsPage.select_package_by_source`` only when the
    # Debug Filters dropdown is missing.
    show_info_toggle: str = (
        'button:has-text("Show Info"), button:has-text("Hide Info")'
    )

    react_modal_overlay: str = ".ReactModal__Overlay--after-open"

    # Production adds "Reject Non-Essential" alongside "Accept All".
    # Production also gates result rendering until the banner is dismissed,
    # so this list must include every variant we have observed in the wild.
    cookie_accept: str = (
        "button:has-text('Accept All'), "
        "button:has-text('Reject All'), "
        "button:has-text('Reject Non-Essential')"
    )


@dataclass(frozen=True)
class CheckoutSelectors:
    autofill_link: str = 'a:has-text("Autofill")'
    submit_btn: str = "#submit_booking"
    no_insurance_label: str = 'label:has-text("No thanks")'

    # Staging checkout is two-stage on some packages (LCC/consolidator inventory
    # notably): Stage 1 = passenger info + insurance + debug options, ending in
    # a "Continue to payment" CTA; Stage 2 = payment form + #submit_booking.
    # On single-stage packages the continue button is absent and #submit_booking
    # renders directly. Both flows are supported.
    continue_to_payment_btn: str = (
        'button:has-text("Continue to payment"), '
        'a:has-text("Continue to payment")'
    )
    # BagAssist baggage insurance: distinct from the travel-protection
    # "No thanks" decline and renders as a clickable row/label.
    baggage_decline_label: str = (
        'label:has-text("willing to risk losing my baggage")'
    )

    cc_number: str = "#cc_number"
    cc_cvv: str = "#cc_cvv"
    cc_expiry: str = "#cc_expiry"
    cc_name: str = "#cc_name"

    p1_first_name: str = "#p1_first_name"
    p1_last_name: str = "#p1_last_name"

    cookie_accept: str = (
        "button:has-text('Accept All'), "
        "button:has-text('Reject All'), "
        "button:has-text('Reject Non-Essential')"
    )

    # Debugging Options panel — present on staging AND production. We match
    # the visible label text and walk to its nearest <select>; the
    # underlying DOM name/id has changed before, the visible label
    # survives longer.
    disable_optimizer_label_text: str = "Disable Optimizer"
    # Production-and-staging production-style failure injection: the
    # "Booking Failure Reason" select on the debug panel forces the
    # backend to fail the booking with a known shape (CC Decline, Fare
    # Increase, Flight Not Available, …). This is what makes a
    # production E2E test safe to run — pick ``cc_decline`` and the
    # supplier never sees the request, the card is never charged, and
    # ``ota.bookings.process_status`` carries a ``BOOKING_FAILED`` row
    # we can validate against.
    booking_failure_reason_label_text: str = "Booking Failure Reason"


@dataclass(frozen=True)
class ConfirmationSelectors:
    success_text: str = "Your booking was successfully completed!"
    post_booking_no_thanks: str = (
        "button:has-text(\"No, I don't want to receive these benefits\")"
    )


@dataclass(frozen=True)
class ResProSelectors:
    login_form: str = "form"
    username_input: str = '[name="username"]'
    password_input: str = '[name="password"]'
    login_submit: str = 'input[type="submit"]'

    override_cancel_link: str = "text=Override to Cancel"
    abort_reason_select: str = "#reason"
    abort_note_input: str = "#note"
    abort_submit: str = "#btn-continue"
    cancelled_status: str = "text=Cancelled:"


@dataclass(frozen=True)
class SummitSelectors:
    # Login page (https://staging2-summit.flighthub.com/). Summit names the
    # username field ``email`` — keep ``username_input`` as the canonical
    # selector key so the constant name matches the rest of the codebase
    # (RESPRO.username_input et al.) and so a future rename of the underlying
    # input surfaces as ``selector_not_found[summit.username_input]``.
    login_form: str = "form.login-form"
    username_input: str = "#email"
    password_input: str = "#password"
    login_submit: str = "#process-login"

    # Stats page (https://staging2-summit.flighthub.com/flight-search/info/<search_id>).
    # Auth-gated: anonymous requests (e.g. ``qa-diag``) redirect to ``/login``
    # and only the four login selectors above match. The five selectors below
    # are confirmed by the throwaway logged-in inspector run for card ue37vUp5
    # (see page_inventory.md § 6 for the captured DOM).
    stats_container: str = "#flightSearchStats"
    stats_lookup_form: str = "#searchIdForm"
    stats_lookup_input: str = "#search_id"
    stats_table: str = "#flightSearchStats fieldset#urlStats table"
    stats_row: str = "#flightSearchStats fieldset.stats"


SEARCH = SearchSelectors()
RESULTS = ResultsSelectors()
CHECKOUT = CheckoutSelectors()
CONFIRMATION = ConfirmationSelectors()
RESPRO = ResProSelectors()
SUMMIT = SummitSelectors()


def all_selectors_for(page_key: str) -> dict[str, str]:
    """Return a flat {name: css} map for a given page key.

    Used by `qa-diag` to probe every selector on a page in one shot.
    `page_key` must be one of: search, results, checkout, confirmation, respro, summit.
    """
    mapping = {
        "search": SEARCH,
        "results": RESULTS,
        "checkout": CHECKOUT,
        "confirmation": CONFIRMATION,
        "respro": RESPRO,
        "summit": SUMMIT,
    }
    try:
        obj = mapping[page_key]
    except KeyError as exc:
        raise ValueError(f"unknown page_key: {page_key}") from exc
    return {f.name: getattr(obj, f.name) for f in fields(obj)}
