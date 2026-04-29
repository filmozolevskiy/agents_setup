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

# IATA marketing-carrier code → display string used by FlightHub /
# JustFly result cards on production. The Best / Cheapest / Shortest
# tiles render the airline name without a flight number, so the
# ``--carrier`` filter falls back to this map when its flight-number
# regex doesn't match. Keep the strings in sync with what the cards
# actually print — partial matches still work because the carrier
# filter wraps each entry in ``\b…\b`` word boundaries (e.g.
# ``Air Canada`` matches both standalone "Air Canada" and the
# operating-carrier disclaimer "Air Canada Rouge"). When in doubt,
# pull the airline name straight from a screenshot of
# ``002-gds-filter-applied.png``.
CARRIER_DISPLAY_NAMES: dict[str, str] = {
    "AC": "Air Canada",
    "WS": "WestJet",
    "PD": "Porter Airlines",
    "TS": "Air Transat",
    "F8": "Flair Airlines",
    "Y9": "Lynx Air",
    "UA": "United Airlines",
    "AA": "American Airlines",
    "DL": "Delta Air Lines",
    "AS": "Alaska Airlines",
    "B6": "JetBlue",
    "F9": "Frontier Airlines",
    "NK": "Spirit Airlines",
    "SY": "Sun Country Airlines",
    "WN": "Southwest Airlines",
    "HA": "Hawaiian Airlines",
    "AV": "Avianca",
    "CM": "Copa Airlines",
    "AM": "Aeromexico",
    "LA": "LATAM Airlines",
    "G3": "GOL",
    "AD": "Azul",
    "LH": "Lufthansa",
    "DE": "Condor",
    "BA": "British Airways",
    "AF": "Air France",
    "KL": "KLM",
    "IB": "Iberia",
    "AY": "Finnair",
    "LX": "Swiss",
    "OS": "Austrian Airlines",
    "SK": "SAS",
    "TP": "TAP Air Portugal",
    "AZ": "ITA Airways",
    "EI": "Aer Lingus",
    "VS": "Virgin Atlantic",
    "TK": "Turkish Airlines",
    "EK": "Emirates",
    "QR": "Qatar Airways",
    "EY": "Etihad Airways",
    "SV": "Saudia",
    "MS": "EgyptAir",
    "ET": "Ethiopian Airlines",
    "KE": "Korean Air",
    "OZ": "Asiana Airlines",
    "NH": "ANA",
    "JL": "Japan Airlines",
    "CX": "Cathay Pacific",
    "SQ": "Singapore Airlines",
    "TG": "Thai Airways",
    "CI": "China Airlines",
    "BR": "EVA Air",
    "QF": "Qantas",
    "NZ": "Air New Zealand",
}


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

    def select_package_by_source(
        self,
        content_source: str,
        package_index: int = 0,
        carrier: str | None = None,
    ) -> None:
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

        If ``carrier`` is given (2-letter IATA code, e.g. ``AC``, ``WS``,
        ``PD``), the runner additionally filters to packages whose
        marketing carrier matches that code — detected by finding
        ``<carrier><digits>`` flight-number tokens in the card text.
        ``package_index`` is then applied to the carrier-filtered subset.

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

        # If --carrier was specified, walk visible Select-button cards and
        # restrict to those whose marketing carrier matches. Detection
        # uses two signals because flighthub's collapsed result cards
        # render the airline **name** (e.g. "Air Canada", "United
        # Airlines") without a flight number — only the expanded card
        # surfaces "<code><digits>" tokens. We match either:
        #   * a flight-number token like ``AC123`` / ``Flight AC 123`` /
        #     ``WS559`` (works on staging consolidator cards and on
        #     production once the card is expanded), OR
        #   * the airline's display name on the card
        #     (``Air Canada`` for ``AC``, ``United Airlines`` for ``UA``,
        #     etc.) which is what production prints on the collapsed
        #     "Best / Cheapest / Shortest" cards.
        # ``CARRIER_DISPLAY_NAMES`` below maps every IATA code we want
        # to support to its display string; missing codes fall back to
        # the flight-number signal only.
        if carrier is not None:
            carrier_code = carrier.strip().upper()
            display_name = CARRIER_DISPLAY_NAMES.get(carrier_code)

            # Two-pass strategy:
            #
            #   Pass 1: scan the unmodified visible card list for
            #   ``<carrier_code><digits>`` flight-number tokens or the
            #   carrier's display name. This catches the common case
            #   where the carrier is already in the top-20 cards,
            #   either as the marketing carrier or as a codeshare leg
            #   (e.g. "Air Transat, Turkish Airlines" on a
            #   Downtowntravel YYZ-IST package).
            #
            #   Pass 2 (only if Pass 1 returns 0): click the airline
            #   pivot header to push the requested carrier's cards to
            #   the top, then re-scan. This rescues routes where the
            #   carrier exists but is buried below the visible window
            #   because it prices higher than AC/WS/PD (e.g. UA on
            #   YYZ-IAH, AA on YYZ-EWR). The pivot click is a no-op
            #   if the pivot is absent.
            #
            # We deliberately do **not** pivot-click first: the
            # codeshare-only "(with others)" pivot column on some
            # builds excludes the visible codeshare cards rather than
            # surfacing them, which would turn a winnable run into a
            # ``source_not_available_in_ui`` false negative.
            matching_indexes = self._scan_visible_cards_for_carrier(
                carrier_code, display_name
            )
            self.screenshot(
                f"carrier-filter-{carrier_code.lower()}-"
                f"{len(matching_indexes)}-matched"
            )
            if not matching_indexes:
                # Pass 2a — sidebar "only" filter. The Airlines
                # sidebar exposes a per-carrier ``<button
                # class="only-btn" value="<IATA>">only</button>``
                # that filters to that carrier including codeshares.
                # This is the most reliable surface — preserves
                # 1-stop / codeshare cards (which the
                # ``"(with others)"`` pivot column drops) and uses
                # the actual IATA code as a stable handle (no display
                # name lookup, no localisation drift).
                if self._click_sidebar_airline_only(carrier_code):
                    matching_indexes = self._scan_visible_cards_for_carrier(
                        carrier_code, display_name
                    )
                    self.screenshot(
                        f"carrier-filter-{carrier_code.lower()}-"
                        f"{len(matching_indexes)}-matched-after-sidebar"
                    )
            if not matching_indexes:
                # Pass 2b — pivot column header. Older builds without
                # the sidebar ``only-btn`` fall back to clicking the
                # airline column in the "Looking for a specific
                # airline?" pivot table. Only useful for nonstop
                # columns; codeshare ``"(with others)"`` columns can
                # filter to 0 even when codeshare cards exist, so we
                # try this last.
                self._click_airline_pivot_header(display_name, carrier_code)
                matching_indexes = self._scan_visible_cards_for_carrier(
                    carrier_code, display_name
                )
                self.screenshot(
                    f"carrier-filter-{carrier_code.lower()}-"
                    f"{len(matching_indexes)}-matched-after-pivot"
                )
            if not matching_indexes:
                raise SourceNotAvailableError(
                    f"content_source={content_source!r} returned {pkg_count} "
                    f"package(s) but none have marketing carrier "
                    f"{carrier_code!r}. The cheapest packages on this route "
                    f"are likely a different carrier (e.g. WS / PD / TS on "
                    f"YUL-origin routes). Try shifting the date by ±1/±7 "
                    f"days, picking a more {carrier_code}-dominant route, "
                    f"or dropping --carrier."
                )
            pick = matching_indexes[min(package_index, len(matching_indexes) - 1)]
        else:
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

    def _scan_visible_cards_for_carrier(
        self,
        carrier_code: str,
        display_name: str | None,
    ) -> list[int]:
        """Walk every visible Select-button card and return the
        indexes whose surrounding card text matches the requested
        carrier as the **marketing** carrier.

        ``--carrier`` always means "marketing/validating carrier" —
        the airline that issues the ticket and whose flight numbers
        appear on the boarding pass — never just an operating
        codeshare. So a card text of "United Airlines, Operated by
        Turkish Airlines" matches ``--carrier UA`` (UA is the
        marketing carrier) but does **not** match ``--carrier TK``
        (TK is only the metal). See
        ``.cursor/skills/qa_automation/SKILL.md`` →
        "When ``--carrier`` is specified, it always means the
        marketing/validating carrier".

        Match signals (any one):
          * a ``<carrier_code><digits>`` flight-number token like
            ``AC123`` / ``Flight AC 123`` / ``WS559``. This is the
            canonical marketing-carrier signal — the flight number
            prefix **is** the marketing carrier code.
          * the carrier's display name on its own (``Air Canada``,
            ``United Airlines``) — only when it is *not* preceded by
            ``"Operated by"`` (case-insensitive). FlightHub cards
            with a codeshare leg render
            ``"<Marketing Airline>, Operated by <Operating Airline>"``
            (or sometimes ``"<Marketing Airline> (Operated by
            <Operating Airline>)"``). Without the operated-by
            exclusion the filter returns false-positive matches for
            the operating-only carrier.

        Walks up the DOM from each Select button until it lands on an
        ancestor whose ``innerText`` is between 250 and 4_000 chars —
        ~card-sized. Smaller wrappers usually only contain price + CTA
        and miss the airline name; larger ones contain multiple cards
        plus page chrome and produce false positives.
        """
        return list(
            self._page.evaluate(
                """({code, displayName}) => {
                    const buttons = Array.from(
                        document.querySelectorAll('button, a')
                    ).filter(b => /\\bSelect\\b/.test(b.innerText || ''));
                    const out = [];
                    const flightNumRe = new RegExp(
                        '\\\\b' + code + '\\\\s*\\\\d{2,5}\\\\b', 'i'
                    );
                    let displayName_lc = null;
                    let escapedRe = null;
                    if (displayName) {
                        displayName_lc = displayName.toLowerCase();
                        const escaped = displayName
                            .replace(/[-/\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
                        escapedRe = new RegExp('\\\\b' + escaped + '\\\\b', 'gi');
                    }

                    // Marketing-only display-name match: scan every
                    // occurrence of the display name and reject any
                    // preceded by "operated by" within ~25 chars.
                    // A single card text can hold both a marketing
                    // mention and an "Operated by <same>" mention
                    // (rare but possible), so we accept the card as
                    // a match as long as **at least one** occurrence
                    // is not preceded by "operated by".
                    const isMarketingDisplayMatch = (text) => {
                        if (!escapedRe) return false;
                        escapedRe.lastIndex = 0;
                        let m;
                        while ((m = escapedRe.exec(text)) !== null) {
                            const start = m.index;
                            const lookback = text
                                .slice(Math.max(0, start - 25), start)
                                .toLowerCase();
                            if (!/operated\\s+by\\s*$/.test(lookback)) {
                                return true;
                            }
                        }
                        return false;
                    };

                    for (let i = 0; i < buttons.length; i++) {
                        const btn = buttons[i];
                        let card = btn.closest(
                            '[class*="package"], [class*="result"], article, li, div'
                        );
                        for (let d = 0; d < 8 && card && card !== document.body; d++) {
                            const len = (card.innerText || '').length;
                            if (len >= 250 && len <= 4000) break;
                            if (len > 4000) {
                                card = null;
                                break;
                            }
                            card = card.parentElement;
                        }
                        const text = (card && card.innerText) || '';
                        if (flightNumRe.test(text)) {
                            out.push(i);
                            continue;
                        }
                        if (isMarketingDisplayMatch(text)) {
                            out.push(i);
                        }
                    }
                    return out;
                }""",
                {"code": carrier_code, "displayName": display_name},
            )
            or []
        )

    def _click_sidebar_airline_only(self, carrier_code: str) -> bool:
        """Click the per-airline "only" button in the left sidebar's
        Airlines filter section.

        FlightHub renders one row per airline in the result-page
        sidebar:

            <label class="checkbox-container" title="Turkish Airlines">
              <input id="filter-airline-TK" value="TK" type="checkbox" .../>
              <div class="name">Turkish Airlines</div>
              <button value="TK" class="only-btn">only</button>
            </label>

        Clicking ``button.only-btn[value="<IATA>"]`` un-checks every
        other airline and leaves only the requested one selected,
        including codeshare cards (where the marketing carrier on
        one of the legs is the requested code). This is the most
        robust signal we have — keyed on the stable IATA value
        attribute rather than the localised display name, and
        unaffected by the codeshare-only pivot quirk.

        Best-effort: only some builds expose ``Show all airlines`` —
        the carrier may be hidden behind that toggle. We attempt to
        expand it before clicking.

        Returns ``True`` if the click landed, ``False`` otherwise so
        the caller can fall through to the pivot-header path.
        """
        try:
            show_all = self._page.locator(
                'button:has-text("Show all airlines"), a:has-text("Show all airlines")'
            ).first
            if show_all.count() > 0:
                try:
                    show_all.scroll_into_view_if_needed(timeout=2_000)
                except Exception:
                    pass
                try:
                    show_all.click(timeout=2_000, force=True)
                    self._page.wait_for_timeout(500)
                except Exception:
                    pass
        except Exception:
            pass

        # The ``only-btn`` is rendered with ``display: none`` until
        # the airline row is hovered (CSS hover affordance), so a
        # Playwright ``locator.click()`` — even with ``force=True`` —
        # silently fails its actionability checks. Fire the React
        # click handler directly via ``HTMLElement.click()`` from
        # within the page context: this bypasses CSS visibility but
        # still triggers the same ``onClick`` that a real user would.
        clicked = self._page.evaluate(
            """(code) => {
                const btn = document.querySelector(
                    'button.only-btn[value="' + code + '"]'
                );
                if (!btn) return false;
                btn.click();
                return true;
            }""",
            carrier_code,
        )
        if not clicked:
            self.screenshot(
                f"sidebar-airline-{carrier_code.lower()}-only-not-found"
            )
            return False

        for overlay_sel in (".loading-banner-wrapper", "text=Filtering results"):
            try:
                self._page.locator(overlay_sel).first.wait_for(
                    state="detached", timeout=15_000
                )
            except Exception:
                pass
        try:
            self._page.locator(RESULTS.select_btn).first.wait_for(
                state="visible", timeout=20_000
            )
        except Exception:
            pass
        self._page.wait_for_timeout(2_500)
        self.screenshot(f"sidebar-airline-{carrier_code.lower()}-only-clicked")
        return True

    def _click_airline_pivot_header(
        self,
        display_name: str | None,
        carrier_code: str,
    ) -> None:
        """Click the airline column header in the "Looking for a specific
        airline?" pivot table at the top of the result page.

        Production renders this table after the GDS filter is applied
        ("Phone Only Deal | Porter Airlines | Air Canada | American
        Airlines | Delta Air Lines"). The column headers are
        clickable filter chips: clicking ``United Airlines`` re-orders
        the result list so that UA cards rise to the top of the
        visible 20-card window. Without this step, on Canadian-origin
        transborder routes UA / AA / DL almost always sit below the
        top 20 because AC / WS / PD price lower.

        Two header variants need to be tried:
          1. ``"<Display Name>"`` — the nonstop column (e.g.
             ``United Airlines``).
          2. ``"<Display Name> (with others)"`` — the codeshare /
             1-stop column when the carrier has no nonstop on the
             route (e.g. ``Turkish Airlines (with others)`` on
             YYZ-IST when TK only sells codeshare via LGW or BCN).

        The locator is **scoped to the pivot section** (below the
        "Looking for a specific airline?" heading) to avoid
        accidentally hitting the same airline name in the left
        sidebar's Airlines checkbox list — clicking the sidebar
        checkbox toggles the airline OFF, which is the opposite of
        what we want.

        Best-effort:
          * No-op if no display name is known for the carrier.
          * No-op if the pivot is absent (older builds, staging, some
            international routes).
          * No-op if neither header variant exists in the pivot.
        """
        if not display_name:
            return
        # The pivot column is a ``<div class="airline-matrix-cell
        # table-header">`` whose inner ``<span class="airline">``
        # holds the display name and whose ``<span class="others">``
        # holds an optional ``"(with others)"`` suffix for codeshare
        # columns. Targeting that class scopes the click to the pivot
        # only — the left-sidebar Airlines filter uses
        # ``<label>``/``<input>`` instead, and clicking a sidebar
        # checkbox toggles the airline OFF (the opposite of what we
        # want).
        #
        # We try the codeshare variant first when it exists — if the
        # carrier has no nonstop column on the route (e.g. TK on
        # YYZ-IST routed via LGW or BCN), only the codeshare column
        # is rendered, and the sidebar still has a plain
        # ``Turkish Airlines`` label that would otherwise win.
        try:
            clicked = False
            variants = (
                f"{display_name} (with others)",
                display_name,
            )
            for variant in variants:
                header = self._page.locator(
                    f'.airline-matrix-cell.table-header:has-text("{variant}")'
                ).first
                if header.count() == 0:
                    continue
                try:
                    header.scroll_into_view_if_needed(timeout=2_000)
                except Exception:
                    pass
                try:
                    header.click(timeout=3_000, force=True)
                    clicked = True
                    break
                except Exception:
                    continue
            if not clicked:
                return

            for overlay_sel in (".loading-banner-wrapper", "text=Filtering results"):
                try:
                    self._page.locator(overlay_sel).first.wait_for(
                        state="detached", timeout=15_000
                    )
                except Exception:
                    pass
            try:
                self._page.locator(RESULTS.select_btn).first.wait_for(
                    state="visible", timeout=20_000
                )
            except Exception:
                pass
            self._page.wait_for_timeout(2_500)
            self.screenshot(
                f"airline-pivot-{carrier_code.lower()}-clicked"
            )
        except Exception:
            pass

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
