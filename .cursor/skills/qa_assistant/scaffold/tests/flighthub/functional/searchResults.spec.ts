import { expect, test } from '../../../fixtures/pom/test-options';
import { Routes } from '../../../enums/flighthub/flighthub';
import { generateOneWaySearch } from '../../../test-data/factories/flighthub/search.factory';
import { RESULTS_DEFAULT_TIMEOUT_MS } from '../../../pages/flighthub/searchResults.page';
import { UNBOOKABLE_ONE_WAY_ROUTES } from '../../../test-data/static/flighthub/unbookableRoutes';

test.describe('flighthub search-results page', () => {
    // Live GDS search routinely takes 30-60s; the global 60s test timeout
    // is too tight once the modal sequence runs after results land.
    test.describe.configure({ timeout: 180000 });

    test.describe('with a populated GDS result list (YUL -> JFK)', () => {
        test.beforeEach(async ({ flighthubHomePage }) => {
            const search = generateOneWaySearch({
                origin: 'YUL',
                destination: 'JFK',
            });
            await flighthubHomePage.submitOneWaySearch(search);
        });

        test(
            'lands on the flight-search route and renders the persistent search bar',
            { tag: '@smoke' },
            async ({ flighthubSearchResultsPage, page }) => {
                await test.step('THEN the URL is the flight-search route', async () => {
                    await expect(page).toHaveURL(
                        new RegExp(`^.*${Routes.FLIGHT_SEARCH}\\?`)
                    );
                });

                await test.step('AND the persistent header search bar is rendered', async () => {
                    await expect(
                        flighthubSearchResultsPage.headerOriginInput
                    ).toBeVisible();
                    await expect(
                        flighthubSearchResultsPage.headerDestinationInput
                    ).toBeVisible();
                    await expect(
                        flighthubSearchResultsPage.headerSearchButton
                    ).toBeVisible();
                });
            }
        );

        test(
            'renders the loading indicator while results are being fetched',
            { tag: '@regression' },
            async ({ flighthubSearchResultsPage }) => {
                await expect(
                    flighthubSearchResultsPage.loadingIndicator
                ).toBeVisible();
            }
        );

        test(
            'exposes the four sort buttons (Best, Cheapest, Shortest, Flexible)',
            { tag: '@regression' },
            async ({ flighthubSearchResultsPage }) => {
                await expect(flighthubSearchResultsPage.sortBest).toBeVisible();
                await expect(
                    flighthubSearchResultsPage.sortCheapest
                ).toBeVisible();
                await expect(
                    flighthubSearchResultsPage.sortShortest
                ).toBeVisible();
                await expect(
                    flighthubSearchResultsPage.sortFlexible
                ).toBeVisible();
            }
        );

        test(
            'exposes the filter section heading',
            { tag: '@regression' },
            async ({ flighthubSearchResultsPage }) => {
                await expect(
                    flighthubSearchResultsPage.filterHeading
                ).toBeVisible();
            }
        );

        test(
            'selecting a result navigates to the real checkout route',
            { tag: '@regression' },
            async ({ flighthubSearchResultsPage, page }) => {
                await test.step('GIVEN the GDS-backed search has populated the result list', async () => {
                    await flighthubSearchResultsPage.waitForResults();
                });

                await test.step('WHEN the user selects the first result and accepts flight-only / default fare', async () => {
                    await flighthubSearchResultsPage.selectFirstResult();
                });

                await test.step('THEN the URL transitions to /checkout/billing/flight/{searchId}/{packageId}', async () => {
                    await expect(page).toHaveURL(
                        new RegExp(
                            `${Routes.FLIGHT_CHECKOUT.replace(/\//g, '\\/')}\\/[a-f0-9]+\\/[a-f0-9]+`
                        ),
                        { timeout: 60000 }
                    );
                });
            }
        );
    });

    for (const route of UNBOOKABLE_ONE_WAY_ROUTES) {
        test(
            `renders the no-results state for an unbookable route — ${route.description}`,
            { tag: '@regression' },
            async ({ flighthubHomePage, flighthubSearchResultsPage }) => {
                await test.step(`GIVEN an unbookable one-way search (${route.origin} -> ${route.destination})`, async () => {
                    await flighthubHomePage.submitOneWaySearch(
                        generateOneWaySearch({
                            origin: route.origin,
                            destination: route.destination,
                        })
                    );
                });

                await test.step('THEN the no-flights heading and body copy are rendered', async () => {
                    await expect(
                        flighthubSearchResultsPage.noResultsHeading
                    ).toBeVisible({ timeout: RESULTS_DEFAULT_TIMEOUT_MS });
                    await expect(
                        flighthubSearchResultsPage.noResultsBody
                    ).toBeVisible();
                });
            }
        );
    }
});
