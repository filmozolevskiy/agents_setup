"""
Single source of truth for every CSS/text selector used by page objects.

When staging front-end deploys break a selector, update it here. Pages import
from this module; no selector constants live anywhere else.

All selectors verified against staging2.flighthub.com / staging2.justfly.com.
Bump the `VERIFIED_ON` string each time this file is edited.
"""
from __future__ import annotations

from dataclasses import dataclass, fields

VERIFIED_ON = "2026-04-24b"


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
    select_btn: str = 'button:has-text("Select")'
    bundle_dismiss_btn: str = ".continue-with-flight-only-btn"
    fare_loading: str = "text=Fetching fare information"
    continue_to_checkout: str = 'button:has-text("Continue to checkout")'

    debug_filter_toggle: str = ".debug-filters-header-toggle"
    gds_select: str = "select#gds"

    react_modal_overlay: str = ".ReactModal__Overlay--after-open"

    cookie_accept: str = "button:has-text('Accept All'), button:has-text('Reject All')"


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

    cookie_accept: str = "button:has-text('Accept All'), button:has-text('Reject All')"

    # Debugging Options panel (staging-only, bottom of checkout). We match the
    # visible label text and walk to its nearest <select>; the underlying DOM
    # name/id has changed before, the visible label survives longer.
    disable_optimizer_label_text: str = "Disable Optimizer"


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
    login_form: str = "form"
    login_submit: str = '[type="submit"]'
    stats_table: str = "table"


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
