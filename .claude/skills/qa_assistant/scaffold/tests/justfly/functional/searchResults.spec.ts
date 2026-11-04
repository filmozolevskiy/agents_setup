import { expect, test } from '../../../fixtures/pom/test-options';
import { Routes } from '../../../enums/justfly/justfly';
import { generateOneWaySearch } from '../../../test-data/factories/justfly/search.factory';
import {
    CHECKOUT_REDIRECT_TIMEOUT_MS,
    RESULTS_DEFAULT_TIMEOUT_MS,
    SEARCH_TEST_TIMEOUT_MS,
} from '../../../pages/justfly/searchResults.page';
import { UNBOOKABLE_ONE_WAY_ROUTES } from '../../../test-data/static/justfly/unbookableRoutes';

test.describe('justfly search-results page', () => {
    // Live GDS search routinely takes 30-60s; the global 60s test timeout
    // is too tight once the modal sequence runs after results land.
    test.describe.configure({ timeout: SEARCH_TEST_TIMEOUT_MS });

    test.describe('with a populated GDS result list (YUL -> JFK)', () => {
        test.beforeEach(async ({ justflyHomePage }) => {
            const search = generateOneWaySearch({
                origin: 'YUL',
                destination: 'JFK',
            });
            await justflyHomePage.submitOneWaySearch(search);
        });

        test(
            'lands on the flight-search route and renders the persistent search bar',
            { tag: '@smoke' },
            async ({ justflySearchResultsPage, page }) => {
                await test.step('THEN the URL is the flight-search route', async () => {
                    await expect(page).toHaveURL(
                        new RegExp(`^.*${Routes.FLIGHT_SEARCH}\\?`)
                    );
                });

                await test.step('AND the persistent header search bar is rendered', async () => {
                    await expect(
                        justflySearchResultsPage.headerOriginInput
                    ).toBeVisible();
                    await expect(
                        justflySearchResultsPage.headerDestinationInput
                    ).toBeVisible();
                    await expect(
                        justflySearchResultsPage.headerSearchButton
                    ).toBeVisible();
                });
            }
        );

        test(
            'renders the loading indicator while results are being fetched',
            { tag: '@regression' },
            async ({ justflySearchResultsPage }) => {
                await expect(
                    justflySearchResultsPage.loadingIndicator
                ).toBeVisible();
            }
        );

        test(
            'exposes the four sort buttons (Best, Cheapest, Shortest, Flexible)',
            { tag: '@regression' },
            async ({ justflySearchResultsPage }) => {
                await expect(justflySearchResultsPage.sortBest).toBeVisible();
                await expect(
                    justflySearchResultsPage.sortCheapest
                ).toBeVisible();
                await expect(
                    justflySearchResultsPage.sortShortest
                ).toBeVisible();
                await expect(
                    justflySearchResultsPage.sortFlexible
                ).toBeVisible();
            }
        );

        test(
            'exposes the filter section heading',
            { tag: '@regression' },
            async ({ justflySearchResultsPage }) => {
                await expect(
                    justflySearchResultsPage.filterHeading
                ).toBeVisible();
            }
        );

        test(
            'selecting a result navigates to the real checkout route',
            { tag: '@regression' },
            async ({ justflySearchResultsPage, page }) => {
                await test.step('GIVEN the GDS-backed search has populated the result list', async () => {
                    await justflySearchResultsPage.waitForResults();
                });

                await test.step('WHEN the user selects the first result and accepts flight-only / default fare', async () => {
                    await justflySearchResultsPage.selectFirstResult();
                });

                await test.step('THEN the URL transitions to /checkout/billing/flight/{searchId}/{packageId}', async () => {
                    await expect(page).toHaveURL(
                        new RegExp(
                            `${Routes.FLIGHT_CHECKOUT.replace(/\//g, '\\/')}\\/[a-f0-9]+\\/[a-f0-9]+`
                        ),
                        { timeout: CHECKOUT_REDIRECT_TIMEOUT_MS }
                    );
                });
            }
        );
    });

    for (const route of UNBOOKABLE_ONE_WAY_ROUTES) {
        test(
            `renders the no-results state for an unbookable route — ${route.description}`,
            { tag: '@regression' },
            async ({ justflyHomePage, justflySearchResultsPage }) => {
                await test.step(`GIVEN an unbookable one-way search (${route.origin} -> ${route.destination})`, async () => {
                    await justflyHomePage.submitOneWaySearch(
                        generateOneWaySearch({
                            origin: route.origin,
                            destination: route.destination,
                        })
                    );
                });

                await test.step('THEN the no-flights heading and body copy are rendered', async () => {
                    await expect(
                        justflySearchResultsPage.noResultsHeading
                    ).toBeVisible({ timeout: RESULTS_DEFAULT_TIMEOUT_MS });
                    await expect(
                        justflySearchResultsPage.noResultsBody
                    ).toBeVisible();
                });
            }
        );
    }
});
