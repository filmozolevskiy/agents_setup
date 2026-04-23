"""
Search form page — FlightHub / JustFly homepage.
Phase 0 confirmed selectors (staging2.flighthub.com, 2026-04-20).

Submit behaviour: the form always opens /flight/search in a NEW TAB (popup)
while navigating the main tab to a hotel partner.  submit() captures and
returns the popup page so callers use it for all subsequent steps.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError

from qa_automation.pages.base_page import BasePage

_SEARCH_FORM = "form.flight-search-form"
_TRIP_TYPE = "div.trip-type-{trip_type}"   # trip_type: oneway | roundtrip | multicity
_ORIGIN_WRAPPER = "div.search-form-input.departure"
_ORIGIN_INPUT = "#seg0_from_display"
_DEST_INPUT = "#seg0_to_display"
_DATE_INPUT = "#seg0_date"
_DATEPICKER_NEXT = ".rdrNextButton"
# Non-disabled, non-passive (visible month) day cells
_DAY_CELL = ".rdrDay:not(.rdrDayDisabled):not(.rdrDayPassive)"
_DATEPICKER_DONE = "button:has-text('Done')"
_SUBMIT_BTN = "div.home-search-form-submit"

# Pax picker — confirmed selectors 2026-04-21 staging2.flighthub.com
_PAX_WRAPPER = ".passenger-input-wrapper"
_PAX_ADT_PLUS = '.dropdown-item:has-text("Adult (12+)") .plus-minus:last-child'
_PAX_CHD_PLUS = '.dropdown-item:has-text("Child (2-11)") .plus-minus:last-child'
_PAX_INF_LAP_PLUS = '.dropdown-item:has-text("Infant on lap") .plus-minus:last-child'
_PAX_CLOSE = "button.landing-cta-btn"


class SearchPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path, base_url: str) -> None:
        super().__init__(page, scenario_dir)
        self._base_url = base_url

    def load(self) -> None:
        self.goto(self._base_url)
        self._page.wait_for_selector(_SEARCH_FORM, timeout=15_000)
        self.screenshot("search-form-loaded")

    def set_trip_type(self, trip_type: str) -> None:
        sel = _TRIP_TYPE.format(trip_type=trip_type)
        self._page.locator(sel).click()
        self._page.wait_for_timeout(300)

    def fill_origin(self, iata: str, display_hint: str) -> None:
        """Click origin wrapper, type IATA, select first autocomplete match."""
        self._page.locator(_ORIGIN_WRAPPER).click()
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

    def fill_departure_date(self, d: date) -> None:
        """Open react-date-range picker, navigate to the target month, click the day."""
        today = date.today()
        months_forward = (d.year - today.year) * 12 + (d.month - today.month)
        self._page.locator(_DATE_INPUT).click()
        self._page.wait_for_timeout(800)
        for _ in range(months_forward):
            self._page.locator(_DATEPICKER_NEXT).click()
            self._page.wait_for_timeout(300)
        target_day = str(d.day)
        day_cells = self._page.locator(_DAY_CELL)
        count = day_cells.count()
        for i in range(count):
            cell = day_cells.nth(i)
            if target_day in cell.inner_text().split():
                cell.click()
                break
        self._page.wait_for_timeout(400)
        # Close picker
        self._page.locator(_DATEPICKER_DONE).click()
        self._page.wait_for_timeout(400)

    def set_passengers(self, adt: int, chd: int = 0, inf: int = 0) -> None:
        """Open the pax picker and set ADT/CHD/INF counts.

        ADT starts at 1, CHD and INF start at 0.
        Selectors confirmed 2026-04-21 on staging2.flighthub.com.
        """
        self._page.locator(_PAX_WRAPPER).click()
        self._page.wait_for_timeout(500)

        # ADT: click + (adt-1) times (picker starts at 1)
        for _ in range(adt - 1):
            self._page.locator(_PAX_ADT_PLUS).click()
            self._page.wait_for_timeout(200)

        for _ in range(chd):
            self._page.locator(_PAX_CHD_PLUS).click()
            self._page.wait_for_timeout(200)

        for _ in range(inf):
            self._page.locator(_PAX_INF_LAP_PLUS).click()
            self._page.wait_for_timeout(200)

        # The "Close" button is CSS-hidden on desktop; dismiss by pressing Escape.
        self._page.keyboard.press("Escape")
        self._page.wait_for_timeout(300)
        self.screenshot("pax-set")

    def submit(self):
        """
        Click Submit and return the page that loads /flight/search.

        Normally the form opens flight search in a NEW TAB (popup) while navigating
        the main tab to a hotel partner.  On some staging runs the popup does not
        appear; in that case we fall back to checking whether the main tab navigated
        to /flight/search directly.
        """
        self.screenshot("search-form-filled")
        # Ensure page JS is settled before clicking.
        self._page.wait_for_load_state("domcontentloaded")
        try:
            with self._page.context.expect_page(timeout=60_000) as popup_info:
                self._page.locator(_SUBMIT_BTN).click(force=True)
            popup = popup_info.value
            self.screenshot("search-submitted")
            return popup
        except PlaywrightTimeoutError:
            # Popup didn't appear — check if the main tab navigated to /flight/search.
            self.screenshot("search-no-popup")
            if "flight/search" in self._page.url:
                return self._page
            raise
