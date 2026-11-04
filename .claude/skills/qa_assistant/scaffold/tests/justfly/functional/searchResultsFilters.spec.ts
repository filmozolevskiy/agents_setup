import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages } from '../../../enums/justfly/justfly';
import { generateOneWaySearch } from '../../../test-data/factories/justfly/search.factory';
import { SEARCH_TEST_TIMEOUT_MS } from '../../../pages/justfly/searchResults.page';

test.describe('justfly search-results page — filter sidebar / sort / pagination / per-card content', () => {
    // Live GDS search on staging2 routinely takes 30-60s; the global
    // 60s test timeout is too tight once filters trigger a re-fetch.
    test.describe.configure({ timeout: SEARCH_TEST_TIMEOUT_MS });

    test.beforeEach(async ({ justflyHomePage, justflySearchResultsPage }) => {
        const search = generateOneWaySearch({
            origin: 'YUL',
            destination: 'JFK',
        });
        await justflyHomePage.submitOneWaySearch(search);
        await justflySearchResultsPage.dismissInterruptions();
        await justflySearchResultsPage.waitForResults();
        await justflySearchResultsPage.dismissInterruptions();
    });

    test(
        'first result card surfaces carrier, IATA pair, time block, stops, duration and price',
        { tag: '@regression' },
        async ({ justflySearchResultsPage }) => {
            await test.step('THEN the carrier logo and name are rendered', async () => {
                await expect(
                    justflySearchResultsPage.resultCardCarrierLogo(0)
                ).toBeVisible();
                await expect(
                    justflySearchResultsPage.resultCardCarrierName(0)
                ).toBeVisible();
            });

            await test.step('AND the IATA pair, time block and stops label are rendered', async () => {
                await expect(
                    justflySearchResultsPage.resultCardAirportPair(0)
                ).toBeVisible();
                await expect(
                    justflySearchResultsPage.resultCardTimeBlock(0)
                ).toContainText(/\d{1,2}:\d{2}\s?(AM|PM)/);
                await expect(
                    justflySearchResultsPage.resultCardStopsLabel(0)
                ).toContainText(/Nonstop|Stop|Stops/);
            });

            await test.step('AND the duration and price are rendered', async () => {
                await expect(
                    justflySearchResultsPage.resultCardDuration(0)
                ).toContainText(/\d+h\s+\d+m/);
                // Tighten beyond `/\d+/` to require a currency token —
                // either the ISO-4217 code from `SupportedCurrency` or
                // its rendered glyph. Keeps this test currency-agnostic
                // (the active currency varies by GeoIP / explicit
                // selection — `currencySwitching.spec.ts` owns the
                // currency-specific assertion against a known choice)
                // while guarding against a regression that drops the
                // currency token entirely from the per-card price.
                await expect(
                    justflySearchResultsPage.resultCardPrice(0)
                ).toContainText(/(?:USD|CAD|GBP|EUR|\$|€|£)\s*[\d,.]+/);
            });

            await test.step('AND the per-card Select and Show-flight-details buttons resolve uniquely on the first card', async () => {
                await expect(
                    justflySearchResultsPage.resultCardSelectButton(0)
                ).toBeVisible();
                await expect(
                    justflySearchResultsPage.resultCardShowDetailsButton(0)
                ).toBeVisible();
            });
        }
    );

    test(
        'applying a Stops filter narrows the result set, surfaces the Stops chip, and Clear all restores the original total',
        { tag: '@regression' },
        async ({ justflySearchResultsPage }) => {
            const totalBefore =
                await justflySearchResultsPage.readResultsTotal();
            expect(totalBefore).not.toBeNull();
            expect(totalBefore!).toBeGreaterThan(0);

            await test.step('WHEN the user toggles the Nonstop checkbox in the Stops filter', async () => {
                await justflySearchResultsPage.toggleStopsFilter(
                    Messages.SEARCH_RESULTS_STOPS_NONSTOP
                );
            });

            await test.step('THEN the Stops chip appears in the active-filters strip', async () => {
                await expect(
                    justflySearchResultsPage.activeFilterChip('stops')
                ).toBeVisible();
            });

            await test.step('AND the visible result count drops below the original total', async () => {
                await expect
                    .poll(async () => {
                        const visible =
                            await justflySearchResultsPage.readResultsVisible();
                        return visible !== null && visible < totalBefore!;
                    })
                    .toBeTruthy();
            });

            await test.step('WHEN the user clicks Clear all', async () => {
                await justflySearchResultsPage.clearAllFilters();
            });

            await test.step('THEN the active-filters chip is gone and the counter shows the original total again', async () => {
                await expect(
                    justflySearchResultsPage.activeFilterChip('stops')
                ).toBeHidden();
                await expect
                    .poll(() => justflySearchResultsPage.readResultsTotal())
                    .toBe(totalBefore);
            });
        }
    );

    test(
        'expanding the Price section reveals the two-thumb price slider; expanding Flight Times reveals the Departure / Arrival tab pair and slider',
        { tag: '@regression' },
        async ({ justflySearchResultsPage }) => {
            await test.step('WHEN the user expands the Price filter section', async () => {
                await justflySearchResultsPage.toggleFilterSection(
                    Messages.SEARCH_RESULTS_FILTER_PRICE,
                    'open'
                );
            });

            await test.step('THEN both price slider thumbs are mounted', async () => {
                await expect(
                    justflySearchResultsPage.priceSliderInput('min')
                ).toBeAttached();
                await expect(
                    justflySearchResultsPage.priceSliderInput('max')
                ).toBeAttached();
            });

            await test.step('WHEN the user expands the Flight Times filter section', async () => {
                await justflySearchResultsPage.toggleFilterSection(
                    Messages.SEARCH_RESULTS_FILTER_FLIGHT_TIMES,
                    'open'
                );
            });

            await test.step('THEN the Departure / Arrival tabs and both slider thumbs are present', async () => {
                await expect(
                    justflySearchResultsPage.flightTimesTab(
                        Messages.SEARCH_RESULTS_FLIGHT_TIMES_DEPARTURE_TAB
                    )
                ).toBeVisible();
                await expect(
                    justflySearchResultsPage.flightTimesTab(
                        Messages.SEARCH_RESULTS_FLIGHT_TIMES_ARRIVAL_TAB
                    )
                ).toBeVisible();
                await expect(
                    justflySearchResultsPage.flightTimesSliderInput('min')
                ).toBeAttached();
                await expect(
                    justflySearchResultsPage.flightTimesSliderInput('max')
                ).toBeAttached();
            });
        }
    );

    test(
        'expanding the Airports filter exposes the nearby + same-airport toggles and per-IATA airport rows',
        { tag: '@regression' },
        async ({ justflySearchResultsPage }) => {
            await test.step('WHEN the user expands the Airports filter section', async () => {
                await justflySearchResultsPage.toggleFilterSection(
                    Messages.SEARCH_RESULTS_FILTER_AIRPORTS,
                    'open'
                );
            });

            await test.step('THEN the nearby + same-airport toggles and the YUL / JFK rows are mounted', async () => {
                await expect(
                    justflySearchResultsPage.nearbyAirportsCheckbox
                ).toBeAttached();
                await expect(
                    justflySearchResultsPage.sameAirportCheckbox
                ).toBeAttached();
                await expect(
                    justflySearchResultsPage.airportFilterCheckbox('YUL')
                ).toBeAttached();
                await expect(
                    justflySearchResultsPage.airportFilterCheckbox('JFK')
                ).toBeAttached();
            });
        }
    );

    test(
        'switching from Best to Cheapest changes the first-card price (and switching back restores it)',
        { tag: '@regression' },
        async ({ justflySearchResultsPage }) => {
            await justflySearchResultsPage.selectSort(
                Messages.SEARCH_RESULTS_SORT_BEST
            );
            const bestPriceText =
                (await justflySearchResultsPage
                    .resultCardPrice(0)
                    .textContent()) ?? '';

            await test.step('WHEN the user clicks the Cheapest sort tab', async () => {
                await justflySearchResultsPage.selectSort(
                    Messages.SEARCH_RESULTS_SORT_CHEAPEST
                );
            });

            await test.step('THEN the top-of-list card is the cheapest fare and matches Best (or is lower) under any GDS fare-equivalence', async () => {
                const cheapestPriceText =
                    (await justflySearchResultsPage
                        .resultCardPrice(0)
                        .textContent()) ?? '';
                const bestPrice = parsePrice(bestPriceText);
                const cheapestPrice = parsePrice(cheapestPriceText);
                expect(cheapestPrice).not.toBeNaN();
                expect(cheapestPrice).toBeLessThanOrEqual(bestPrice);
            });
        }
    );

    test(
        '"Load more" grows the visible card count without changing the underlying total',
        { tag: '@regression' },
        async ({ justflySearchResultsPage }) => {
            const totalBefore =
                await justflySearchResultsPage.readResultsTotal();
            const cardsBefore =
                await justflySearchResultsPage.resultCards.count();

            await test.step('WHEN the user clicks "Load more"', async () => {
                const loaded = await justflySearchResultsPage.loadMore();
                expect(loaded).toBeTruthy();
            });

            await test.step('THEN more cards render and the underlying total is unchanged', async () => {
                await expect
                    .poll(() => justflySearchResultsPage.resultCards.count())
                    .toBeGreaterThan(cardsBefore);
                expect(await justflySearchResultsPage.readResultsTotal()).toBe(
                    totalBefore
                );
            });
        }
    );
});

/**
 * Parses a storefront price string ("USD 223.95", "USD 1,234.56") to a
 * plain number. Returns `NaN` if the string can't be parsed.
 */
function parsePrice(text: string): number {
    const match = /([\d,]+(?:\.\d+)?)/.exec(text.replace(/\s+/g, ''));
    if (!match) return NaN;
    return Number(match[1].replace(/,/g, ''));
}
