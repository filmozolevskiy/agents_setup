import { Locator, Page, expect } from '@playwright/test';
import { Messages } from '../../enums/justfly/justfly';

/**
 * Default upper bound for waiting on live flight inventory to populate the
 * results list. Staging2 routinely takes 30-60 seconds to return a full
 * GDS response, so callers can pass a higher value to `selectFirstResult`
 * for slow / cold-start runs.
 */
export const RESULTS_DEFAULT_TIMEOUT_MS = 90000;

/** Best-effort click budget for the optional cookie + promo dismissals. */
export const INTERRUPTION_DISMISS_TIMEOUT_MS = 2000;

/** Per-arm budget for the post-Select interstitial `Promise.race`. */
export const INTERSTITIAL_RACE_TIMEOUT_MS = 30000;

/** Upper bound for the storefront landing on /checkout/billing/flight/... */
export const CHECKOUT_REDIRECT_TIMEOUT_MS = 60000;

/**
 * Per-test budget for search-results specs — covers the GDS wait
 * (~30-60s) plus the post-Select interstitial sequence and a buffer.
 */
export const SEARCH_TEST_TIMEOUT_MS = 180000;

/**
 * Page object for the JustFly flight-search results page at
 * `/flight/search?...`. JustFly shares the genesis-storefront codebase
 * with Flighthub, so the surface mirrors `FlighthubSearchResultsPage`:
 * persistent header search bar, sort + filter chrome, result-card Select
 * buttons, and the modal sequence (cookie consent, fare-deals promo,
 * bundle upsell, fare-upgrade) sitting between Select and the real
 * `/checkout/billing/flight/...` URL.
 */
export class JustflySearchResultsPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators — header search bar ====================

    get headerOriginInput(): Locator {
        return this.page.getByRole('textbox', {
            name: Messages.SEARCH_RESULTS_HEADER_LEAVING_FROM,
        });
    }

    get headerDestinationInput(): Locator {
        return this.page.getByRole('textbox', {
            name: Messages.SEARCH_RESULTS_HEADER_GOING_TO,
        });
    }

    get headerSearchButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.SEARCH_RESULTS_HEADER_SEARCH_BUTTON,
        });
    }

    // ==================== Locators — sort buttons ====================

    get sortBest(): Locator {
        return this.page.getByRole('button', { name: /^Best/ });
    }

    get sortCheapest(): Locator {
        return this.page.getByRole('button', { name: /^Cheapest/ });
    }

    get sortShortest(): Locator {
        return this.page.getByRole('button', { name: /^Shortest/ });
    }

    get sortFlexible(): Locator {
        return this.page.getByRole('button', { name: /^Flexible/ });
    }

    get fareAlertsButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.SEARCH_RESULTS_FARE_ALERTS,
        });
    }

    // ==================== Locators — result cards ====================

    get resultCards(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- card wrapper has no role; class is stable.
        return this.page.locator('.new-package-wrapper');
    }

    resultCard(idx: number): Locator {
        // eslint-disable-next-line playwright/no-nth-methods -- N cards in DOM order; index is the public addressing scheme.
        return this.resultCards.nth(idx);
    }

    resultCardCarrierLogo(idx: number): Locator {
        /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods --
           per-card carrier logo class duplicates across the card surface
           + inline-details panel; the first copy is the visible CTA logo. */
        return this.resultCard(idx).locator('img.carrier-logo').first();
        /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */
    }

    resultCardCarrierName(idx: number): Locator {
        /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods --
           per-segment `.airlines` is rendered twice (IATA pair, then
           airline name); the airline name is always the last copy. */
        return this.resultCard(idx)
            .locator('.airline-details .airlines')
            .last();
        /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */
    }

    resultCardAirportPair(idx: number): Locator {
        /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods --
           IATA pair is the first `.airlines` copy; airline name is the
           second. The class itself is the only stable hook. */
        return this.resultCard(idx)
            .locator('.airline-details .airlines')
            .first();
        /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */
    }

    resultCardTimeBlock(idx: number): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- inner `.time` is the storefront's depart+arrive wrapper; no role.
        return this.resultCard(idx).locator('.airline-details .time');
    }

    resultCardStopsLabel(idx: number): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- `.stops` is the only stable hook for the label.
        return this.resultCard(idx).locator('.segment-stops .stops');
    }

    resultCardDuration(idx: number): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- `.flight-duration > span` carries the duration text; no role.
        return this.resultCard(idx).locator(
            '.segment-stops .flight-duration span'
        );
    }

    resultCardPrice(idx: number): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- `.price` carries the formatted USD amount.
        return this.resultCard(idx).locator('.pricing-section .price');
    }

    // Storefront renders the Select CTA as `<button>` on staging2 and as
    // `<a>` (link role) on prod for the same fare slot. `.or()` keeps the
    // locator role-agnostic so the same spec runs on both environments
    // without env-specific branching.
    resultCardSelectButton(idx: number): Locator {
        return this.resultCard(idx)
            .getByRole('button', {
                name: Messages.SEARCH_RESULTS_RESULT_SELECT,
                exact: true,
            })
            .or(
                this.resultCard(idx).getByRole('link', {
                    name: Messages.SEARCH_RESULTS_RESULT_SELECT,
                    exact: true,
                })
            );
    }

    resultCardShowDetailsButton(idx: number): Locator {
        return this.resultCard(idx).getByRole('button', {
            name: Messages.SEARCH_RESULTS_SHOW_FLIGHT_DETAILS,
        });
    }

    get selectButton(): Locator {
        return this.page
            .getByRole('button', {
                name: Messages.SEARCH_RESULTS_RESULT_SELECT,
                exact: true,
            })
            .or(
                this.page.getByRole('link', {
                    name: Messages.SEARCH_RESULTS_RESULT_SELECT,
                    exact: true,
                })
            );
    }

    get showFlightDetailsButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.SEARCH_RESULTS_SHOW_FLIGHT_DETAILS,
        });
    }

    // ==================== Locators — filter sidebar ====================

    get filtersWrapper(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- sidebar wrapper has no role on staging2.
        return this.page.locator('.filters-wrapper');
    }

    filterSection(name: Messages): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- section wrapper has no role; the header text inside it scopes the lookup.
        return this.page.locator('.filter-section').filter({
            has: this.page.getByText(name, { exact: true }),
        });
    }

    filterSectionToggle(name: Messages): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- the toggle is `.filter-header` div with no role.
        return this.filterSection(name).locator('.filter-header');
    }

    stopsFilterRow(label: Messages): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- per-row wrapper is `.variant-checkbox`; the label text inside disambiguates.
        return this.filterSection(Messages.SEARCH_RESULTS_FILTER_STOPS)
            .locator('.variant-checkbox')
            .filter({
                has: this.page.getByText(label, { exact: true }),
            });
    }

    stopsFilterCheckbox(label: Messages): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- bare `<input type=checkbox>`; no a11y label.
        return this.stopsFilterRow(label).locator('input[type="checkbox"]');
    }

    stopsFilterOnlyButton(label: Messages): Locator {
        return this.stopsFilterRow(label).getByRole('button', {
            name: Messages.SEARCH_RESULTS_STOPS_ONLY,
            exact: true,
        });
    }

    airlinesFilterRow(carrierName: string): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- per-row wrapper is `.variant-checkbox`; carrier name inside disambiguates.
        return this.filterSection(Messages.SEARCH_RESULTS_FILTER_AIRLINES)
            .locator('.variant-checkbox')
            .filter({
                has: this.page.getByText(carrierName, { exact: true }),
            });
    }

    airlinesFilterCheckbox(carrierName: string): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- bare `<input type=checkbox>`; no a11y label.
        return this.airlinesFilterRow(carrierName).locator(
            'input[type="checkbox"]'
        );
    }

    get airlinesShowAllButton(): Locator {
        return this.filterSection(
            Messages.SEARCH_RESULTS_FILTER_AIRLINES
        ).getByText(Messages.SEARCH_RESULTS_AIRLINES_SHOW_ALL, {
            exact: true,
        });
    }

    flightTimesTab(
        which:
            | Messages.SEARCH_RESULTS_FLIGHT_TIMES_DEPARTURE_TAB
            | Messages.SEARCH_RESULTS_FLIGHT_TIMES_ARRIVAL_TAB
    ): Locator {
        return this.filterSection(
            Messages.SEARCH_RESULTS_FILTER_FLIGHT_TIMES
        ).getByRole('button', { name: which, exact: true });
    }

    // MUI slider: visible thumb has `pointer-events: none`, so callers must
    // drive value changes via `.fill()` / `.evaluate()` on the bare input.
    // `data-index="0"` = lower bound, `="1"` = upper bound.
    flightTimesSliderInput(end: 'min' | 'max'): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- MUI slider exposes no role; data-index addresses each thumb.
        return this.filterSection(
            Messages.SEARCH_RESULTS_FILTER_FLIGHT_TIMES
        ).locator(
            `input[type="range"][data-index="${end === 'min' ? '0' : '1'}"]`
        );
    }

    priceSliderInput(end: 'min' | 'max'): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- MUI slider exposes no role.
        return this.filterSection(Messages.SEARCH_RESULTS_FILTER_PRICE).locator(
            `input[type="range"][data-index="${end === 'min' ? '0' : '1'}"]`
        );
    }

    get nearbyAirportsCheckbox(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- id is the only stable hook for the bare input.
        return this.page.locator('#filter-airport-near-by');
    }

    get sameAirportCheckbox(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- id is the only stable hook for the bare input.
        return this.page.locator('#filter-airport-only-same');
    }

    airportFilterRow(iata: string): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- per-row wrapper; IATA prefix anchors the row.
        return this.filterSection(Messages.SEARCH_RESULTS_FILTER_AIRPORTS)
            .locator('.variant-checkbox')
            .filter({
                has: this.page.getByText(new RegExp(`^${iata}\\b`)),
            });
    }

    airportFilterCheckbox(iata: string): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- bare `<input type=checkbox>`.
        return this.airportFilterRow(iata).locator('input[type="checkbox"]');
    }

    get activeFiltersHeader(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- header strip has no role.
        return this.page.locator('.active-filters');
    }

    get resultsCounter(): Locator {
        return this.activeFiltersHeader.getByText(/\d+\s+(results?|of)/);
    }

    get clearAllFiltersButton(): Locator {
        return this.activeFiltersHeader.getByRole('button', {
            name: Messages.SEARCH_RESULTS_CLEAR_ALL,
            exact: true,
        });
    }

    activeFilterChip(
        category: 'stops' | 'airlines' | 'flight-times' | 'price' | 'airports'
    ): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- chip is `<button class="active-filter-btn" data-value="…">`; no a11y name.
        return this.activeFiltersHeader.locator(
            `.active-filter-btn[data-value="${category}"]`
        );
    }

    // ==================== Locators — pagination ====================

    get loadMoreButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.SEARCH_RESULTS_LOAD_MORE,
            exact: true,
        });
    }

    // ==================== Locators — post-Select modals ====================

    get bundleContinueWithFlightOnly(): Locator {
        return this.page
            .getByRole('button', {
                name: Messages.SEARCH_RESULTS_BUNDLE_CONTINUE_FLIGHT_ONLY,
            })
            .or(
                this.page.getByRole('link', {
                    name: Messages.SEARCH_RESULTS_BUNDLE_CONTINUE_FLIGHT_ONLY,
                })
            );
    }

    get fareUpgradeContinueToCheckout(): Locator {
        return this.page.getByRole('button', {
            name: Messages.SEARCH_RESULTS_FARE_CONTINUE_TO_CHECKOUT,
        });
    }

    // ==================== Locators — fare-family panel (prod) ====================

    get fareFamilyPanel(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- modal-type class is the only stable wrapper hook; the React tree below it uses hashed CSS-module class names.
        return this.page.locator('.fare-families-full-page');
    }

    get fareFamilyContinueToCheckout(): Locator {
        return this.fareFamilyPanel.getByRole('button', {
            name: Messages.SEARCH_RESULTS_FARE_CONTINUE_TO_CHECKOUT,
            exact: true,
        });
    }

    // ==================== Locators — interruption banners ====================

    // Osano CMP banner exposes the same `.osano-cm-button--type_denyAll`
    // class on staging2 (button text "Reject All") and prod (button text
    // "Reject Non-Essential"); the class is the stable hook across both.
    get cookieDenyAllButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- Osano banner exposes no role/label, only this class.
        return this.page.locator('.osano-cm-button--type_denyAll');
    }

    get priceDealsDialog(): Locator {
        return this.page
            .getByRole('dialog')
            .filter({ hasText: Messages.SEARCH_RESULTS_PRICE_DEALS_DIALOG });
    }

    // ==================== Feedback Locators ====================

    get loadingIndicator(): Locator {
        return this.page.getByText(Messages.SEARCH_RESULTS_LOADING, {
            exact: true,
        });
    }

    get filterHeading(): Locator {
        return this.page.getByText(Messages.SEARCH_RESULTS_FILTER_HEADING, {
            exact: true,
        });
    }

    get resultsCount(): Locator {
        return this.page.getByText(
            /\d+\s+(results?\s+found|of\s+\d+\s+results)/
        );
    }

    get noResultsHeading(): Locator {
        return this.page.getByText(Messages.SEARCH_RESULTS_NO_FLIGHTS_HEADING, {
            exact: true,
        });
    }

    get noResultsBody(): Locator {
        return this.page.getByText(Messages.SEARCH_RESULTS_NO_FLIGHTS_BODY, {
            exact: true,
        });
    }

    // ==================== Actions ====================

    /**
     * Waits for the GDS response to populate the page by gating on the
     * "N results found" text and the first Select button.
     *
     * @param timeoutMs - Upper bound; defaults to `RESULTS_DEFAULT_TIMEOUT_MS`.
     * @returns Promise that resolves once the first result is selectable.
     */
    async waitForResults(
        timeoutMs: number = RESULTS_DEFAULT_TIMEOUT_MS
    ): Promise<void> {
        await expect(this.resultsCount).toBeVisible({ timeout: timeoutMs });
        // eslint-disable-next-line playwright/no-nth-methods -- N selectable cards, only need top one to be visible.
        await expect(this.selectButton.first()).toBeVisible({
            timeout: timeoutMs,
        });
    }

    /**
     * Best-effort dismissal of the cookie-consent banner and the
     * "Find out when prices change" promo dialog, both of which can
     * intercept pointer events on result cards.
     *
     * @returns Promise that resolves once both interruptions are
     * dismissed (or were already absent).
     */
    async dismissInterruptions(): Promise<void> {
        try {
            await this.cookieDenyAllButton.click({
                timeout: INTERRUPTION_DISMISS_TIMEOUT_MS,
            });
        } catch {
            // Banner did not appear — fall through.
        }
        if (await this.priceDealsDialog.isVisible()) {
            const closeIcon = this.priceDealsDialog
                .getByText(Messages.SEARCH_RESULTS_DIALOG_CLOSE_GLYPH, {
                    exact: true,
                })
                // eslint-disable-next-line playwright/no-nth-methods -- multiple × glyphs may render; either dismisses.
                .first();
            try {
                await closeIcon.click({
                    timeout: INTERRUPTION_DISMISS_TIMEOUT_MS,
                });
            } catch {
                // Promo can't be closed — fall through.
            }
        }
    }

    /**
     * Selects the first result and walks the post-Select interstitial
     * sequence (cookie banner → optional fare-family panel → optional
     * bundle upsell → optional fare-upgrade modal) to land on the real
     * `/checkout/billing/flight/...` URL. See the Flighthub mirror for
     * the full per-environment matrix — JustFly shares the same
     * storefront and the same paths.
     *
     * @param options.resultsTimeoutMs - Override for `waitForResults`.
     * @returns Promise that resolves after the final interstitial click
     * or the direct URL transition; caller asserts the resulting URL.
     */
    async selectFirstResult(options?: {
        resultsTimeoutMs?: number;
    }): Promise<void> {
        await this.dismissInterruptions();
        await this.waitForResults(
            options?.resultsTimeoutMs ?? RESULTS_DEFAULT_TIMEOUT_MS
        );
        await this.dismissInterruptions();
        // eslint-disable-next-line playwright/no-nth-methods -- pick the top-of-list result.
        await this.selectButton.first().click();

        // eslint-disable-next-line playwright/no-nth-methods -- one button per fare option; default fare is first.
        const fareModalContinue = this.fareUpgradeContinueToCheckout.first();
        // eslint-disable-next-line playwright/no-nth-methods -- panel renders two CTAs (sticky header + base-card variant); first is header copy.
        const fareFamilyContinue = this.fareFamilyContinueToCheckout.first();
        const checkoutUrlMatcher = /\/checkout\/billing\/flight\//;

        const firstWinner = await Promise.race([
            this.page
                .waitForURL(checkoutUrlMatcher, {
                    timeout: INTERSTITIAL_RACE_TIMEOUT_MS,
                })
                .then(() => 'url' as const),
            this.bundleContinueWithFlightOnly
                .waitFor({
                    state: 'visible',
                    timeout: INTERSTITIAL_RACE_TIMEOUT_MS,
                })
                .then(() => 'bundle' as const),
            fareModalContinue
                .waitFor({
                    state: 'visible',
                    timeout: INTERSTITIAL_RACE_TIMEOUT_MS,
                })
                .then(() => 'fare' as const),
            fareFamilyContinue
                .waitFor({
                    state: 'visible',
                    timeout: INTERSTITIAL_RACE_TIMEOUT_MS,
                })
                .then(() => 'farefamily' as const),
        ]);

        if (firstWinner === 'url') {
            return;
        }

        if (firstWinner === 'farefamily') {
            await fareFamilyContinue.click();
            await this.page.waitForURL(checkoutUrlMatcher, {
                timeout: INTERSTITIAL_RACE_TIMEOUT_MS,
            });
            return;
        }

        if (firstWinner === 'bundle') {
            await this.bundleContinueWithFlightOnly.click();
            const next = await Promise.race([
                this.page
                    .waitForURL(checkoutUrlMatcher, {
                        timeout: INTERSTITIAL_RACE_TIMEOUT_MS,
                    })
                    .then(() => 'url' as const),
                fareModalContinue
                    .waitFor({
                        state: 'visible',
                        timeout: INTERSTITIAL_RACE_TIMEOUT_MS,
                    })
                    .then(() => 'fare' as const),
            ]);
            if (next === 'fare') {
                await fareModalContinue.click();
            }
            return;
        }

        await fareModalContinue.click();
    }

    /**
     * Toggles a filter section open or closed. The Stops and Airlines
     * sections are open by default; Flight Times / Price / Airports
     * collapse until clicked. Idempotent — call before any locator
     * lookup inside a collapsible section.
     *
     * @param name - The section's `Messages.SEARCH_RESULTS_FILTER_*` label.
     * @param state - `'open'` ensures expanded, `'closed'` ensures collapsed.
     *               Calling without a state toggles the current state.
     */
    async toggleFilterSection(
        name: Messages,
        state?: 'open' | 'closed'
    ): Promise<void> {
        const section = this.filterSection(name);
        // eslint-disable-next-line playwright/no-raw-locators -- the body's `.filter-container` only renders when the section is open; presence is the open-state oracle.
        const body = section.locator('.filter-container');
        const isOpen = (await body.count()) > 0;
        if (state === 'open' && isOpen) return;
        if (state === 'closed' && !isOpen) return;
        await this.filterSectionToggle(name).click();
    }

    /**
     * Reads the dynamic results counter and parses out the numeric
     * total. Works for both the unfiltered ("N results found") and
     * the filtered ("Showing N of M results") forms — returns the
     * total in both cases.
     *
     * @returns The total result count surfaced by the counter, or
     *          `null` if the counter has not rendered yet.
     */
    async readResultsTotal(): Promise<number | null> {
        const text = (await this.resultsCounter.textContent()) ?? '';
        const filtered = /of\s+(\d+)\s+results/.exec(text);
        if (filtered) return Number(filtered[1]);
        const unfiltered = /(\d+)\s+results?\s+found/.exec(text);
        if (unfiltered) return Number(unfiltered[1]);
        return null;
    }

    /**
     * Reads the dynamic results counter and parses out the *visible*
     * count (`N` in "Showing N of M results"). Falls back to the
     * total when no filter is active.
     */
    async readResultsVisible(): Promise<number | null> {
        const text = (await this.resultsCounter.textContent()) ?? '';
        const filtered = /Showing\s+(\d+)\s+of/.exec(text);
        if (filtered) return Number(filtered[1]);
        const unfiltered = /(\d+)\s+results?\s+found/.exec(text);
        if (unfiltered) return Number(unfiltered[1]);
        return null;
    }

    /**
     * Toggles the matching `Stops` checkbox via its visible `<label>`
     * row. The native `<input>` is offscreen-styled (the storefront
     * positions it visually-hidden and delegates clicks to the
     * `.variant-checkbox` row), so clicking the row is the only
     * pointer-event-respecting path.
     *
     * @param label - The `Messages.SEARCH_RESULTS_STOPS_*` to flip.
     */
    async toggleStopsFilter(label: Messages): Promise<void> {
        await this.toggleFilterSection(
            Messages.SEARCH_RESULTS_FILTER_STOPS,
            'open'
        );
        await this.stopsFilterRow(label).scrollIntoViewIfNeeded();
        await this.stopsFilterRow(label).click();
    }

    /**
     * Toggles the matching `Airlines` checkbox. Same reason as
     * `toggleStopsFilter` for clicking the row instead of the input.
     */
    async toggleAirlineFilter(carrierName: string): Promise<void> {
        await this.toggleFilterSection(
            Messages.SEARCH_RESULTS_FILTER_AIRLINES,
            'open'
        );
        await this.airlinesFilterRow(carrierName).scrollIntoViewIfNeeded();
        await this.airlinesFilterRow(carrierName).click();
    }

    /**
     * Clears every active filter via the global Clear-all button.
     * Idempotent — when no filters are active the button is hidden
     * and the call is a no-op.
     */
    async clearAllFilters(): Promise<void> {
        if (await this.clearAllFiltersButton.isVisible()) {
            await this.clearAllFiltersButton.click();
        }
    }

    /**
     * Clicks one of the four sort tabs. The page re-orders cards
     * client-side; callers can compare `resultCardPrice(0)` /
     * `resultCardDuration(0)` before vs after to assert the sort
     * actually changed the order.
     */
    async selectSort(
        which:
            | Messages.SEARCH_RESULTS_SORT_BEST
            | Messages.SEARCH_RESULTS_SORT_CHEAPEST
            | Messages.SEARCH_RESULTS_SORT_SHORTEST
            | Messages.SEARCH_RESULTS_SORT_FLEXIBLE
    ): Promise<void> {
        await this.page
            .getByRole('button', { name: new RegExp(`^${which}`) })
            .click();
    }

    /**
     * Clicks "Load more" if it's visible (paginated results grow in
     * place rather than navigating).
     *
     * @returns `true` if a click landed, `false` if the button was
     *          absent (final page).
     */
    async loadMore(): Promise<boolean> {
        if (!(await this.loadMoreButton.isVisible())) return false;
        await this.loadMoreButton.click();
        return true;
    }
}
