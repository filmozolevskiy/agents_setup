import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages, Routes } from '../../../enums/justfly/justfly';
import {
    generateOneWaySearch,
    generateRoundTripSearch,
} from '../../../test-data/factories/justfly/search.factory';

test.describe('justfly home page — search form', () => {
    test.beforeEach(async ({ justflyHomePage }) => {
        await justflyHomePage.open();
    });

    test(
        'renders the hero heading and the primary search form fields',
        { tag: '@smoke' },
        async ({ justflyHomePage }) => {
            await test.step('GIVEN the home page has loaded', async () => {
                await expect(justflyHomePage.heroHeading).toBeVisible();
            });

            await test.step('THEN the search form exposes origin, destination, dates and passengers', async () => {
                await expect(justflyHomePage.originInput).toBeVisible();
                await expect(justflyHomePage.destinationInput).toBeVisible();
                await expect(justflyHomePage.departingDatePicker).toBeVisible();
                await expect(justflyHomePage.returningDatePicker).toBeVisible();
                await expect(justflyHomePage.passengersInput).toBeVisible();
                await expect(justflyHomePage.searchSubmit).toBeVisible();
            });

            await test.step('AND the trip-type tabs are present', async () => {
                await expect(justflyHomePage.roundTripTab).toBeVisible();
                await expect(justflyHomePage.oneWayTab).toBeVisible();
                await expect(justflyHomePage.multiCityTab).toBeVisible();
            });
        }
    );

    test(
        'submitting a one-way search navigates to the search-results route',
        { tag: '@smoke' },
        async ({ justflyHomePage, page }) => {
            const search = generateOneWaySearch();

            await test.step('WHEN the user submits a valid one-way search', async () => {
                await justflyHomePage.submitOneWaySearch(search);
            });

            await test.step('THEN the URL transitions to the flight-search route with the supplied params', async () => {
                await expect(page).toHaveURL(
                    new RegExp(`${Routes.FLIGHT_SEARCH}\\?.*type=oneway`)
                );
                await expect(page).toHaveURL(
                    new RegExp(`seg0_from=${search.origin}`)
                );
                await expect(page).toHaveURL(
                    new RegExp(`seg0_to=${search.destination}`)
                );
            });
        }
    );

    test(
        'submitting a round-trip search routes to /flight/search with both segments',
        { tag: '@regression' },
        async ({ justflyHomePage, page }) => {
            const search = generateRoundTripSearch();

            await test.step('WHEN the user submits a valid round-trip search', async () => {
                await justflyHomePage.submitRoundTripSearch(search);
            });

            await test.step('THEN the URL contains both seg0 and seg1 params', async () => {
                await expect(page).toHaveURL(
                    new RegExp(`${Routes.FLIGHT_SEARCH}\\?.*type=roundtrip`)
                );
                await expect(page).toHaveURL(
                    new RegExp(`seg1_date=${search.returnDate}`)
                );
            });
        }
    );

    test(
        'invalid params (empty origin) redirect back to the home route',
        { tag: '@regression' },
        async ({ justflyHomePage, page }) => {
            await test.step('WHEN the user submits a search with an empty origin', async () => {
                await justflyHomePage.submitOneWaySearch(
                    generateOneWaySearch({ origin: '' })
                );
            });

            await test.step('THEN the storefront sends the user back to the home page', async () => {
                await expect(page).toHaveURL(/\/$/);
            });
        }
    );

    // The "missing field" modal cases (Messages.SEARCH_ORIGIN_REQUIRED /
    // SEARCH_DESTINATION_REQUIRED) are unreachable from the storefront on
    // staging2 — the home form auto-pre-fills both origin and destination
    // (and the trip dates) from a GeoIP-derived suggestion before submit,
    // so a cleared field is silently restored at click time. The strings
    // are kept in the enum for future use; the same-IATA case below is
    // the only validation path the auto-fill cannot mask.
    test(
        'surfaces the validation modal when origin equals destination',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            await test.step('GIVEN the cookie banner is dismissed', async () => {
                await justflyHomePage.dismissCookieBanner();
            });

            await test.step('WHEN the user commits the same IATA in both origin and destination via the autocomplete', async () => {
                await justflyHomePage.selectAirport('origin', 'YUL');
                await justflyHomePage.selectAirport('destination', 'YUL');
                await justflyHomePage.searchSubmit.click();
            });

            await test.step('THEN the validation modal surfaces with the same-IATA error', async () => {
                await expect(
                    justflyHomePage.searchValidationModal
                ).toBeVisible();
                await expect(
                    justflyHomePage.searchValidationModalHeading
                ).toBeVisible();
                await expect(
                    justflyHomePage.searchValidationError(
                        Messages.SEARCH_AIRPORTS_NOT_DIFFERENT
                    )
                ).toBeVisible();
            });
        }
    );
});
