"""
Search results page — /flight/search.
Phase 0 confirmed selectors (staging2.flighthub.com, 2026-04-20).

The results page is a React SPA.  Selecting a package goes through two modal
steps before the browser navigates away to checkout:
  1. Bundle modal  → dismiss with .continue-with-flight-only-btn
  2. Fare family   → wait for fare load, then click "Continue to checkout"

Debug Filters panel (staging only, collapsed by default):
  Toggle: .debug-filters-header-toggle  ("Show" / "Hide")
  GDS select: select#gds  — option values are Title-cased (e.g. "Amadeus", "Kiwi")
  Selects are added to DOM dynamically when the panel is expanded.
"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage

_SELECT_BTN = 'button:has-text("Select")'
_BUNDLE_DISMISS_BTN = ".continue-with-flight-only-btn"
_FARE_LOADING = "text=Fetching fare information"
_CONTINUE_TO_CHECKOUT = 'button:has-text("Continue to checkout")'

# Debug Filters panel
_DEBUG_FILTER_TOGGLE = ".debug-filters-header-toggle"
_GDS_SELECT = "select#gds"

# Modal overlay that can block clicks on the results page (e.g. upsell popups)
_REACT_MODAL_OVERLAY = ".ReactModal__Overlay--after-open"

_RESULTS_LOAD_TIMEOUT = 60_000
_FARE_LOAD_TIMEOUT = 30_000


class SourceNotAvailableError(Exception):
    """Raised when the requested content source has no packages in the results UI.

    Callers should try a different search (route/date) rather than falling back
    to a different content source — the booking must match what was requested.
    """


class ResultsPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path) -> None:
        super().__init__(page, scenario_dir)
        self._search_hash: str | None = None

    def wait_for_results(self) -> None:
        # wait_for_url would raise ERR_FAILED when the ad network navigation is
        # aborted by the route handler, so poll the URL instead.
        deadline_ms = _RESULTS_LOAD_TIMEOUT
        poll_ms = 500
        elapsed = 0
        while "flight/search" not in self._page.url:
            self._page.wait_for_timeout(poll_ms)
            elapsed += poll_ms
            assert elapsed < deadline_ms, (
                f"Timed out waiting for /flight/search — current URL: {self._page.url}"
            )
        self._page.wait_for_selector(_SELECT_BTN, timeout=_RESULTS_LOAD_TIMEOUT)
        self._page.wait_for_timeout(2_000)
        self._dismiss_cookie_banner()
        self.screenshot("results-page-loaded")

    @property
    def search_hash(self) -> str | None:
        return self._search_hash

    def _dismiss_cookie_banner(self) -> None:
        """Dismiss the Osano cookie consent banner — it blocks clicks on results in headless mode."""
        try:
            btn = self._page.locator("button:has-text('Accept All'), button:has-text('Reject All')")
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                self._page.wait_for_timeout(300)
        except Exception:
            pass

    def _dismiss_modal(self) -> None:
        """Dismiss any open React modal overlay (upsell/info popups) that blocks clicks."""
        try:
            overlay = self._page.locator(_REACT_MODAL_OVERLAY)
            if overlay.count() == 0 or not overlay.first.is_visible():
                return
            self._page.keyboard.press("Escape")
            self._page.wait_for_timeout(400)
            if overlay.count() > 0 and overlay.first.is_visible():
                overlay.first.click(force=True)
                self._page.wait_for_timeout(400)
            # Some modals (e.g. storefront-modal-overlay) ignore Escape and overlay clicks.
            # Remove via JS so it doesn't block subsequent interactions.
            if overlay.count() > 0 and overlay.first.is_visible():
                self._page.evaluate(
                    """() => {
                        document.querySelectorAll('.ReactModal__Overlay--after-open').forEach(el => {
                            el.style.pointerEvents = 'none';
                            el.style.display = 'none';
                        });
                    }"""
                )
                self._page.wait_for_timeout(200)
        except Exception:
            pass

    def select_package_by_source(self, content_source: str, package_index: int = 0) -> None:
        """Filter results by GDS/content source, then select the first matching package.

        Uses the Debug Filters panel (staging only). The GDS select option values are
        Title-cased; matching is done case-insensitively with hyphen-stripping to handle
        edge cases like "navitairendc" ↔ "Navitaire-ndc".

        If no matching option is found in the dropdown (new source not yet listed), falls
        back to selecting the first available package.

        If the option is found but no packages appear after filtering, sets
        `self.no_source_packages_in_ui = True`, resets the filter, and falls back to
        the first available package. The post-booking gds_raw check then queries
        ClickHouse to determine whether the source was called at search time.
        """
        # 0. Dismiss any modal overlay that may block the debug filter toggle
        self._dismiss_modal()

        # 1. Expand the Debug Filters panel (it's collapsed by default)
        toggle = self._page.locator(_DEBUG_FILTER_TOGGLE)
        if toggle.count() > 0:
            text = toggle.inner_text()
            if "Show" in text:
                toggle.click()
                # Wait for the select elements to be added to the DOM
                self._page.wait_for_selector(_GDS_SELECT, timeout=5_000)
                self._page.wait_for_timeout(300)

        # 2. Find a matching option in the GDS select (case-insensitive, hyphen-tolerant)
        gds_option_value = self._page.evaluate(
            """(source) => {
                const sel = document.querySelector('select#gds');
                if (!sel) return null;
                const norm = s => s.toLowerCase().replace(/-/g, '');
                const match = Array.from(sel.options).find(
                    o => norm(o.value) === norm(source)
                );
                return match ? match.value : null;
            }""",
            content_source,
        )

        if gds_option_value is None:
            raise SourceNotAvailableError(
                f"content_source={content_source!r} has no option in the GDS filter dropdown"
            )

        # 3. Select the GDS option via JS to avoid headless interactability issues
        #    (the panel animation can leave the select non-interactable briefly).
        self._page.evaluate(
            """(val) => {
                const sel = document.querySelector('select#gds');
                if (sel) {
                    sel.value = val;
                    sel.dispatchEvent(new Event('change', {bubbles: true}));
                }
            }""",
            gds_option_value,
        )
        self._page.wait_for_timeout(2_000)
        self.screenshot("gds-filter-applied")

        # 4. Check if any packages are visible for this source
        pkg_count = self._page.locator(_SELECT_BTN).count()
        if pkg_count == 0:
            self.screenshot("gds-filter-zero-packages")
            raise SourceNotAvailableError(
                f"content_source={content_source!r} filter applied but 0 packages returned"
            )

        # 5. Select the requested package by index (0 = first, 1 = second for retry, etc.)
        pick = min(package_index, pkg_count - 1)
        self._page.locator(_SELECT_BTN).nth(pick).click()
        self._page.wait_for_selector(_BUNDLE_DISMISS_BTN, timeout=10_000)
        self.screenshot("bundle-modal-opened")

        self._page.locator(_BUNDLE_DISMISS_BTN).click()
        self._proceed_to_checkout()

    def _proceed_to_checkout(self) -> None:
        """After dismissing the bundle modal, handle either direct checkout navigation
        or the intermediate fare-family panel (both are valid paths)."""
        # Some packages (e.g. tripstack) navigate directly to /checkout after bundle dismiss —
        # give it up to 20s before assuming a fare-family panel will be shown.
        try:
            self._page.wait_for_url("**/checkout/billing/flight/**", timeout=20_000)
            self.screenshot("navigated-to-checkout-directly")
            return
        except Exception:
            pass

        # Fare family panel — wait for fare data to finish loading, then continue.
        self._page.wait_for_selector(_FARE_LOADING, state="hidden", timeout=_FARE_LOAD_TIMEOUT)
        self._page.wait_for_timeout(500)
        self.screenshot("fare-family-loaded")
        self._page.locator(_CONTINUE_TO_CHECKOUT).first.click(timeout=60_000)
        self.screenshot("continue-to-checkout-clicked")

    def select_first_package(self, package_index: int = 0) -> None:
        """
        Click Select → dismiss bundle modal → wait for fare family → go to checkout.
        """
        self._dismiss_modal()
        pkg_count = self._page.locator(_SELECT_BTN).count()
        pick = min(package_index, max(pkg_count - 1, 0))
        self._page.locator(_SELECT_BTN).nth(pick).click()
        self._page.wait_for_selector(_BUNDLE_DISMISS_BTN, timeout=10_000)
        self.screenshot("bundle-modal-opened")

        self._page.locator(_BUNDLE_DISMISS_BTN).click()

        # Fare family panel loads inline (URL unchanged)
        self._page.wait_for_selector(_FARE_LOADING, state="hidden", timeout=_FARE_LOAD_TIMEOUT)
        self._page.wait_for_timeout(500)
        self.screenshot("fare-family-loaded")

        self._page.locator(_CONTINUE_TO_CHECKOUT).first.click()
        self.screenshot("continue-to-checkout-clicked")
