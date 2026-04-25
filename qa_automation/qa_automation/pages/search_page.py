"""
Search form page — FlightHub / JustFly homepage.
Selectors live in `qa_automation.pages.selectors.SEARCH`.

Submit behaviour: the form always opens /flight/search in a NEW TAB (popup)
while navigating the main tab to a hotel partner.  submit() captures and
returns the popup page so callers use it for all subsequent steps.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError

from qa_automation.pages.base_page import BasePage, SelectorNotFound
from qa_automation.pages.selectors import SEARCH


class SearchPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path, base_url: str) -> None:
        super().__init__(page, scenario_dir)
        self._base_url = base_url

    def load(self) -> None:
        self.goto(self._base_url)
        self.wait_for("search.form", SEARCH.form, timeout=15_000)
        self.screenshot("search-form-loaded")

    def set_trip_type(self, trip_type: str) -> None:
        sel = SEARCH.trip_type_template.format(trip_type=trip_type)
        self.click(f"search.trip_type_{trip_type}", sel)
        self._page.wait_for_timeout(300)

    def fill_origin(self, iata: str, display_hint: str) -> None:
        """Click origin wrapper, type IATA, select first autocomplete match."""
        self.click("search.origin_wrapper", SEARCH.origin_wrapper)
        self._page.wait_for_timeout(300)
        self._page.keyboard.type(iata, delay=60)
        self._page.wait_for_timeout(1200)
        self._page.get_by_text(display_hint, exact=False).first.click()
        self._page.wait_for_timeout(500)

    def fill_destination(self, iata: str) -> None:
        """Focus dest input via JS, type IATA, use ArrowDown+Enter to select."""
        self._page.evaluate("document.getElementById('seg0_to_display').focus()")
        self._page.wait_for_timeout(200)
        self._page.keyboard.type(iata, delay=60)
        self._page.wait_for_timeout(1200)
        self._page.keyboard.press("ArrowDown")
        self._page.wait_for_timeout(300)
        self._page.keyboard.press("Enter")
        self._page.wait_for_timeout(400)

    def fill_dates(self, depart: date, return_: date | None = None) -> None:
        """Open the range date-picker once, pick depart (and optional return), Set.

        The staging calendar is a range picker with both months visible at once.
        The confirm button is disabled until both dates are picked for roundtrips,
        so we select all dates first and only click the confirm button once at
        the end.
        """
        self.click("search.date_input", SEARCH.date_input)
        self._page.wait_for_timeout(800)

        today = date.today()
        months_forward = (depart.year - today.year) * 12 + (depart.month - today.month)
        for _ in range(months_forward):
            self.click("search.datepicker_next", SEARCH.datepicker_next)
            self._page.wait_for_timeout(300)

        self._click_day(depart, label="depart")
        if return_ is not None:
            extra_months = (return_.year - depart.year) * 12 + (return_.month - depart.month)
            for _ in range(max(0, extra_months - 1)):
                self.click("search.datepicker_next", SEARCH.datepicker_next)
                self._page.wait_for_timeout(300)
            self._click_day(return_, label="return")

        self._page.wait_for_timeout(400)
        self.click("search.datepicker_done", SEARCH.datepicker_done)
        self._page.wait_for_timeout(400)

    def fill_departure_date(self, d: date) -> None:
        """Back-compat shim: pick a single date and close the picker."""
        self.fill_dates(d)

    def _click_day(self, d: date, *, label: str) -> None:
        target_day = str(d.day)
        day_cells = self._page.locator(SEARCH.day_cell)
        count = day_cells.count()
        for i in range(count):
            cell = day_cells.nth(i)
            if target_day in cell.inner_text().split():
                cell.click()
                return
        raise SelectorNotFound(
            f"search.day_cell[{label}]",
            url=self._page.url,
            detail=f"day {target_day} not found in current month view",
        )

    def set_passengers(self, adt: int, chd: int = 0, inf: int = 0) -> None:
        """Open the pax picker and set ADT/CHD/INF counts.

        ADT starts at 1, CHD and INF start at 0.
        """
        self.click("search.pax_wrapper", SEARCH.pax_wrapper)
        self._page.wait_for_timeout(500)

        for _ in range(adt - 1):
            self.click("search.pax_adt_plus", SEARCH.pax_adt_plus)
            self._page.wait_for_timeout(200)

        for _ in range(chd):
            self.click("search.pax_chd_plus", SEARCH.pax_chd_plus)
            self._page.wait_for_timeout(200)

        for _ in range(inf):
            self.click("search.pax_inf_lap_plus", SEARCH.pax_inf_lap_plus)
            self._page.wait_for_timeout(200)

        # The "Close" button is CSS-hidden on desktop; dismiss by pressing Escape.
        self._page.keyboard.press("Escape")
        self._page.wait_for_timeout(300)
        self.screenshot("pax-set")

    def submit(self):
        """Click Submit and return the page that loads /flight/search.

        Normally the form opens flight search in a NEW TAB (popup) while navigating
        the main tab to a hotel partner.  On some staging runs the popup does not
        appear; in that case we fall back to checking whether the main tab navigated
        to /flight/search directly.
        """
        self.screenshot("search-form-filled")
        self._page.wait_for_load_state("domcontentloaded")
        try:
            with self._page.context.expect_page(timeout=60_000) as popup_info:
                self._page.locator(SEARCH.submit_btn).click(force=True)
            popup = popup_info.value
            self.screenshot("search-submitted")
            return popup
        except PlaywrightTimeoutError:
            self.screenshot("search-no-popup")
            if "flight/search" in self._page.url:
                return self._page
            raise SelectorNotFound(
                "search.submit_btn",
                url=self._page.url,
                detail="submit click produced neither popup nor /flight/search navigation",
            )
