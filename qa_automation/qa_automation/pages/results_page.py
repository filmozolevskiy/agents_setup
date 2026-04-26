"""
Search results page — /flight/search.

Same code path on staging (``staging2.flighthub.com``) and production
(``www.flighthub.com``). Selectors live in
``qa_automation.pages.selectors.RESULTS`` and are written as unions where
the two envs diverge cosmetically (``button`` vs ``a``, "Reject All" vs
"Reject Non-Essential", etc.).

Selecting a package is a 3-step SPA flow:
  1. Bundle modal — dismiss with the bundle dismiss CTA.
  2. Fare family modal (production) / fare-family inline panel (staging).
  3. Continue to checkout / Checkout — navigates to /checkout/billing/flight/.

Content-source pinning is identical on both envs as of 2026-04-26:
  * Both envs expose a Debug Filters panel with a single
    ``select#gds`` that re-runs the search constrained to one source.
    ``select_package_by_source`` uses this as the primary path.
  * Both envs also render a per-card "Show Info" toggle that, when
    expanded, prints ``gds => <source>`` inline. ``select_package_by_source``
    falls back to this if the Debug Filters dropdown is absent (older
    builds, future deploys that remove it). The fallback reveals
    those panels for every visible card and clicks Select on the
    Nth card that matches the requested source.
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

        Best-effort extraction of price / carrier / content-source labels
        from the DOM. Returns a list of dicts like::

            {"index": 0, "total_display": "USD 315.39",
             "validating_carrier": "AC", "content_source": "amadeus"}

        Missing fields are omitted. Use for agent reasoning only — not an
        assertion target.

        Both staging (``<button>Select</button>``) and production
        (``<a>Select</a>``) are scanned. ``content_source`` is pulled
        from any of:
          * card-level ``data-gds`` / ``data-content-source`` /
            ``data-source`` attribute (staging consolidator surfaces),
          * ``gds => <source>`` inline text revealed by the production
            "Show Info" toggle (we expose the toggle ourselves before
            scanning to ensure those panels are open).
        """
        self._dismiss_modal()
        self._reveal_show_info_panels()
        cards = self._page.evaluate(
            """(maxCount) => {
                const ctas = Array.from(
                    document.querySelectorAll('button, a')
                ).filter(el => /\\bSelect\\b/.test(el.innerText || ''));
                const out = [];
                for (let i = 0; i < Math.min(ctas.length, maxCount); i++) {
                    const btn = ctas[i];
                    let card = btn.closest('[class*="package"], [class*="result"], article, li, div');
                    for (let depth = 0; depth < 6 && card && card !== document.body; depth++) {
                        if (card && (card.innerText || '').length > 40) break;
                        card = card ? card.parentElement : null;
                    }
                    const text = (card && card.innerText) || '';
                    let total_display = null;
                    let m = text.match(/\\b([A-Z]{3})\\s*([\\d,]+\\.\\d{2})\\b/);
                    if (m) total_display = `${m[1]} ${m[2]}`;
                    else {
                        m = text.match(/\\$([\\d,]+\\.\\d{2})/);
                        if (m) total_display = `USD ${m[1]}`;
                    }
                    const carrierMatch = text.match(/\\b([A-Z0-9]{2})\\s*[-·]\\s*[A-Za-z]/);
                    let source = card && (
                        card.getAttribute('data-gds') ||
                        card.getAttribute('data-content-source') ||
                        card.getAttribute('data-source')
                    );
                    if (!source) {
                        const gm = text.match(/gds\\s*=>\\s*([A-Za-z0-9_\\-]+)/i);
                        if (gm) source = gm[1];
                    }
                    const entry = {index: i};
                    if (total_display) entry.total_display = total_display;
                    if (carrierMatch) entry.validating_carrier = carrierMatch[1];
                    if (source) entry.content_source = source;
                    out.push(entry);
                }
                return out;
            }""",
            max_count,
        )
        return list(cards or [])

    def _reveal_show_info_panels(self) -> None:
        """Expand the per-card debug "Show Info" panels on production.

        Production renders a "Show Info" toggle on every package card; the
        click reveals an inline ``gds => <source>`` line plus the
        package_id and carrier code. The toggle is global on the
        ``<body>``: a single click flips every card from "Show Info" to
        "Hide Info". Best-effort — silent no-op on builds where the
        toggle is absent (staging, older prod deploys).
        """
        try:
            toggle = self._page.locator(RESULTS.show_info_toggle).first
            if toggle.count() == 0:
                return
            label = toggle.inner_text(timeout=1_000)
            if "Hide" in label:
                return
            try:
                toggle.scroll_into_view_if_needed(timeout=2_000)
            except Exception:
                pass
            toggle.click(timeout=5_000, force=True)
            self._page.wait_for_timeout(400)
        except Exception:
            pass

    # ---------- package selection ----------

    def select_package_by_source(self, content_source: str, package_index: int = 0) -> None:
        """Pin the booking to a content source, then click Select.

        Two backends, picked at runtime based on what the build exposes:

        * **Debug Filters dropdown** (primary; present on both staging
          and production as of 2026-04-26). Open the Debug Filters
          panel, set ``select#gds`` to the requested source, wait for
          the search to re-run, then click Select on the Nth surviving
          card.
        * **Per-card "Show Info" panel** (fallback; used only if the
          dropdown is absent). Reveal Show Info on every visible card,
          locate the Nth card whose panel reads ``gds => <source>``,
          and click Select on that card.

        ``--package-index`` shifts the pick within the matching subset.
        ``SourceNotAvailableError`` is raised if neither path finds a
        matching package after the source has been applied.
        """
        self._dismiss_modal()

        toggle = self._page.locator(RESULTS.debug_filter_toggle)
        gds_select_present = self._page.locator(RESULTS.gds_select).count() > 0
        if toggle.count() == 0 and not gds_select_present:
            self._select_by_show_info(content_source, package_index)
            return

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

    def _select_by_show_info(self, content_source: str, package_index: int) -> None:
        """Fallback content-source pin via the per-card "Show Info" panel.

        Used when ``select#gds`` is absent. Each card carries a debug
        "Show Info" toggle that, when expanded, prints
        ``gds => <source>`` (plus the package_id and validating
        carrier) inline. We reveal those panels for every card, scan
        for matches against ``content_source`` (case-insensitive,
        ``-`` ignored to match staging's normalisation), and click
        Select on the ``package_index``-th matching card.

        The optimizer is still active at this point — pinning here only
        controls *which package the user clicked Select on*. The
        optimizer can still reroute at book time, which is why the
        runner also flips Debugging Options → Disable Optimizer in
        ``CheckoutPage.disable_optimizer`` before submitting.
        """
        self._reveal_show_info_panels()
        pkg_count = self._page.locator(RESULTS.select_btn).count()
        if pkg_count == 0:
            self.screenshot("show-info-zero-packages")
            raise SourceNotAvailableError(
                "0 packages returned on results page; nothing to filter "
                "by --content-source on the production-style results UI"
            )

        match_indices: list[int] = self._page.evaluate(
            """({source}) => {
                const norm = s => (s || '').toLowerCase().replace(/-/g, '');
                const target = norm(source);
                const ctas = Array.from(
                    document.querySelectorAll('button, a')
                ).filter(el => /\\bSelect\\b/.test(el.innerText || ''));
                const out = [];
                for (let i = 0; i < ctas.length; i++) {
                    let card = ctas[i].closest('[class*="package"], [class*="result"], article, li, div');
                    for (let depth = 0; depth < 6 && card && card !== document.body; depth++) {
                        if (card && (card.innerText || '').length > 40) break;
                        card = card ? card.parentElement : null;
                    }
                    const text = (card && card.innerText) || '';
                    const dataAttr = card && (
                        card.getAttribute('data-gds') ||
                        card.getAttribute('data-content-source') ||
                        card.getAttribute('data-source')
                    );
                    let detected = null;
                    if (dataAttr) detected = dataAttr;
                    if (!detected) {
                        const m = text.match(/gds\\s*=>\\s*([A-Za-z0-9_\\-]+)/i);
                        if (m) detected = m[1];
                    }
                    if (detected && norm(detected) === target) {
                        out.push(i);
                    }
                }
                return out;
            }""",
            {"source": content_source},
        )
        match_indices = list(match_indices or [])
        if not match_indices:
            self.screenshot("show-info-no-source-match")
            raise SourceNotAvailableError(
                f"content_source={content_source!r}: no result card carried "
                f"a matching debug source after expanding 'Show Info'. The "
                f"optimizer-style UI has no per-call gate; either no "
                f"package from this source landed in the result set, or the "
                f"per-card debug toggle did not surface ``gds =>`` text. "
                f"Try a different route/date or use --package-index."
            )

        pick_in_subset = min(package_index, len(match_indices) - 1)
        target_dom_index = match_indices[pick_in_subset]
        self.screenshot("show-info-source-matched")

        last_err: Exception | None = None
        for attempt in range(3):
            try:
                fresh = self._page.locator(RESULTS.select_btn).nth(target_dom_index)
                fresh.scroll_into_view_if_needed(timeout=5_000)
                self._page.wait_for_timeout(400)
                fresh.click(timeout=15_000, force=True)
                last_err = None
                break
            except Exception as exc:
                last_err = exc
                self.screenshot(f"show-info-click-retry-{attempt + 1}")
                self._page.wait_for_timeout(2_000)
        if last_err is not None:
            raise last_err

        self.wait_for(
            "results.bundle_dismiss_btn",
            RESULTS.bundle_dismiss_btn,
            timeout=15_000,
        )
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
