"""
Search results page — /flight/search.
Selectors live in `qa_automation.pages.selectors.RESULTS`.

Selecting a package is a 3-step SPA flow:
  1. Bundle modal  → dismiss with .continue-with-flight-only-btn
  2. Fare family   → wait for fare load, then click "Continue to checkout"

Debug Filters panel (staging only, collapsed by default) lets us constrain
results to a single content source via select#gds.
"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage, SelectorNotFound
from qa_automation.pages.selectors import RESULTS

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
        self.no_source_packages_in_ui = False

    def wait_for_results(self) -> None:
        deadline_ms = _RESULTS_LOAD_TIMEOUT
        poll_ms = 500
        elapsed = 0
        while "flight/search" not in self._page.url:
            self._page.wait_for_timeout(poll_ms)
            elapsed += poll_ms
            if elapsed >= deadline_ms:
                raise SelectorNotFound(
                    "results.flight_search_url",
                    url=self._page.url,
                    detail="page never navigated to /flight/search within timeout",
                )
        self.wait_for("results.select_btn", RESULTS.select_btn, timeout=_RESULTS_LOAD_TIMEOUT)
        self._page.wait_for_timeout(2_000)
        self._dismiss_cookie_banner()
        self.screenshot("results-page-loaded")

    @property
    def search_hash(self) -> str | None:
        return self._search_hash

    def _dismiss_cookie_banner(self) -> None:
        try:
            btn = self._page.locator(RESULTS.cookie_accept)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                self._page.wait_for_timeout(300)
        except Exception:
            pass

    def _dismiss_modal(self) -> None:
        """Dismiss any open React modal overlay (upsell/info popups) that blocks clicks."""
        try:
            overlay = self._page.locator(RESULTS.react_modal_overlay)
            if overlay.count() == 0 or not overlay.first.is_visible():
                return
            self._page.keyboard.press("Escape")
            self._page.wait_for_timeout(400)
            if overlay.count() > 0 and overlay.first.is_visible():
                overlay.first.click(force=True)
                self._page.wait_for_timeout(400)
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

    # ---------- package enumeration (no selection) ----------

    def list_debug_filter_sources(self) -> list[str]:
        """Return the list of content-source option values in select#gds.

        Empty list if the Debug Filters panel is not available on this build.
        """
        self._dismiss_modal()
        toggle = self._page.locator(RESULTS.debug_filter_toggle)
        if toggle.count() == 0:
            return []
        text = toggle.inner_text()
        if "Show" in text:
            toggle.click()
            try:
                self.wait_for("results.gds_select", RESULTS.gds_select, timeout=5_000)
            except SelectorNotFound:
                return []
            self._page.wait_for_timeout(300)

        options = self._page.evaluate(
            """() => {
                const sel = document.querySelector('select#gds');
                if (!sel) return [];
                return Array.from(sel.options).map(o => o.value).filter(v => v);
            }"""
        )
        return list(options or [])

    def enumerate_packages(self, max_count: int = 20) -> list[dict]:
        """Scrape visible package cards without clicking Select.

        Best-effort extraction of price / carrier / content-source labels from the
        DOM. Returns a list of dicts like:
            {"index": 0, "total_display": "USD 315.39", "validating_carrier": "AC",
             "content_source": "amadeus"}
        Missing fields are omitted. Use for agent reasoning only — not an assertion target.
        """
        self._dismiss_modal()
        cards = self._page.evaluate(
            """(maxCount) => {
                const buttons = Array.from(document.querySelectorAll('button'))
                    .filter(b => /\\bSelect\\b/.test(b.innerText || ''));
                const out = [];
                for (let i = 0; i < Math.min(buttons.length, maxCount); i++) {
                    const btn = buttons[i];
                    let card = btn.closest('[class*="package"], [class*="result"], article, li, div');
                    for (let depth = 0; depth < 6 && card && card !== document.body; depth++) {
                        if (card && (card.innerText || '').length > 40) break;
                        card = card ? card.parentElement : null;
                    }
                    const text = (card && card.innerText) || '';
                    // Price patterns common on flighthub checkout/results
                    let total_display = null;
                    let m = text.match(/\\b([A-Z]{3})\\s*([\\d,]+\\.\\d{2})\\b/);
                    if (m) total_display = `${m[1]} ${m[2]}`;
                    else {
                        m = text.match(/\\$([\\d,]+\\.\\d{2})/);
                        if (m) total_display = `USD ${m[1]}`;
                    }
                    const carrierMatch = text.match(/\\b([A-Z0-9]{2})\\s*[-·]\\s*[A-Za-z]/);
                    const sourceAttr = card && (
                        card.getAttribute('data-gds') ||
                        card.getAttribute('data-content-source') ||
                        card.getAttribute('data-source')
                    );
                    const entry = {index: i};
                    if (total_display) entry.total_display = total_display;
                    if (carrierMatch) entry.validating_carrier = carrierMatch[1];
                    if (sourceAttr) entry.content_source = sourceAttr;
                    out.push(entry);
                }
                return out;
            }""",
            max_count,
        )
        return list(cards or [])

    # ---------- package selection ----------

    def select_package_by_source(self, content_source: str, package_index: int = 0) -> None:
        """Filter results by content source via Debug Filters, then Select the Nth match."""
        self._dismiss_modal()

        toggle = self._page.locator(RESULTS.debug_filter_toggle)
        if toggle.count() > 0:
            text = toggle.inner_text()
            if "Show" in text:
                toggle.click()
                self.wait_for("results.gds_select", RESULTS.gds_select, timeout=5_000)
                self._page.wait_for_timeout(300)

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
        # Applying a Debug Filter kicks off a fresh search against only that
        # content source, which on staging can take up to ~90s (same shape as
        # the initial results wait). Poll for Select buttons until they appear.
        deadline_ms = 90_000
        poll_interval_ms = 2_000
        elapsed = 0
        pkg_count = 0
        while elapsed < deadline_ms:
            pkg_count = self._page.locator(RESULTS.select_btn).count()
            if pkg_count > 0:
                break
            self._page.wait_for_timeout(poll_interval_ms)
            elapsed += poll_interval_ms
        self.screenshot("gds-filter-applied")

        if pkg_count == 0:
            self.screenshot("gds-filter-zero-packages")
            raise SourceNotAvailableError(
                f"content_source={content_source!r} filter applied but 0 packages "
                f"returned after {deadline_ms/1000:.0f}s wait"
            )

        # Wait for the loading-banner overlay (fare pricing + top-of-page banner)
        # AND the "Filtering results" banner (rendered by consolidator sources
        # like Tripstack that re-run the search after filter apply) to go away
        # before clicking; they intercept pointer events and the Select button
        # can re-render while results are still settling.
        for overlay_sel in (".loading-banner-wrapper", "text=Filtering results"):
            try:
                self._page.locator(overlay_sel).first.wait_for(
                    state="detached", timeout=30_000
                )
            except Exception:
                pass
        self._page.wait_for_timeout(1_000)

        # Guard: consolidator sources (e.g. tripstack) re-run the search after
        # the filter is applied, and the staging UI may initially render GDS
        # fallback Select buttons that disappear ~30-60s later when the
        # source-only result set resolves to zero. Before clicking, check for
        # the explicit "No flights found" empty-state and fail fast.
        no_results = self._page.locator(
            "text=/No flights found|No results found/i"
        )
        if no_results.count() > 0 and no_results.first.is_visible():
            self.screenshot("gds-filter-no-flights-found")
            raise SourceNotAvailableError(
                f"content_source={content_source!r}: UI rendered 'No flights found' "
                f"after applying the Debug Filter. The source has no matching "
                f"inventory for this search (route/dates/pax). Try a different "
                f"route, shift dates ±1/±7 days, or relax pax (e.g. drop INF)."
            )

        # Re-fetch the locator each attempt: consolidators like tripstack
        # re-search continuously which replaces Select-button DOM nodes every
        # few seconds. Fresh locator + force=True bypasses stale handles and
        # whatever loading banner hasn't detached yet.
        pick = min(package_index, pkg_count - 1)
        last_err: Exception | None = None
        for attempt in range(3):
            # Re-check the empty-state between retries in case the source-only
            # result set collapses to 0 during our retry window.
            if no_results.count() > 0 and no_results.first.is_visible():
                self.screenshot("gds-filter-no-flights-found-midway")
                raise SourceNotAvailableError(
                    f"content_source={content_source!r}: UI collapsed to "
                    f"'No flights found' between retry {attempt} and {attempt + 1}. "
                    f"The source has no matching inventory for this search."
                )
            try:
                fresh = self._page.locator(RESULTS.select_btn).nth(pick)
                fresh.scroll_into_view_if_needed(timeout=5_000)
                self._page.wait_for_timeout(400)
                fresh.click(timeout=15_000, force=True)
                last_err = None
                break
            except Exception as exc:
                last_err = exc
                self.screenshot(f"gds-filter-click-retry-{attempt + 1}")
                self._page.wait_for_timeout(2_000)
        if last_err is not None:
            raise last_err
        self.wait_for("results.bundle_dismiss_btn", RESULTS.bundle_dismiss_btn, timeout=10_000)
        self.screenshot("bundle-modal-opened")

        self.click("results.bundle_dismiss_btn", RESULTS.bundle_dismiss_btn)
        self._proceed_to_checkout()

    def select_first_package(self, package_index: int = 0) -> None:
        """Select a package by position without applying a content-source filter."""
        self._dismiss_modal()
        pkg_count = self._page.locator(RESULTS.select_btn).count()
        if pkg_count == 0:
            raise SourceNotAvailableError("0 packages returned on search results page")
        pick = min(package_index, max(pkg_count - 1, 0))
        self._page.locator(RESULTS.select_btn).nth(pick).click()
        self.wait_for("results.bundle_dismiss_btn", RESULTS.bundle_dismiss_btn, timeout=10_000)
        self.screenshot("bundle-modal-opened")

        self.click("results.bundle_dismiss_btn", RESULTS.bundle_dismiss_btn)
        self._proceed_to_checkout()

    def _proceed_to_checkout(self) -> None:
        """Handle either direct checkout navigation or the fare-family panel."""
        try:
            self._page.wait_for_url("**/checkout/billing/flight/**", timeout=20_000)
            self.screenshot("navigated-to-checkout-directly")
            return
        except Exception:
            pass

        self.wait_for(
            "results.fare_loading",
            RESULTS.fare_loading,
            timeout=_FARE_LOAD_TIMEOUT,
            state="hidden",
        )
        self._page.wait_for_timeout(500)
        self.screenshot("fare-family-loaded")
        self.click(
            "results.continue_to_checkout",
            RESULTS.continue_to_checkout,
            timeout=60_000,
        )
        self.screenshot("continue-to-checkout-clicked")
