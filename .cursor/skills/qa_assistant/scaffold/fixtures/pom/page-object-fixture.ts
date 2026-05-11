import { test as base } from '@playwright/test';
import { FlighthubHomePage } from '../../pages/flighthub/home.page';
import { FlighthubSearchResultsPage } from '../../pages/flighthub/searchResults.page';
import { FlighthubCheckoutPage } from '../../pages/flighthub/checkout.page';
import { FlighthubBookingConfirmationPage } from '../../pages/flighthub/bookingConfirmation.page';
import { JustflyHomePage } from '../../pages/justfly/home.page';
import { JustflySearchResultsPage } from '../../pages/justfly/searchResults.page';
import { JustflyCheckoutPage } from '../../pages/justfly/checkout.page';
import { JustflyBookingConfirmationPage } from '../../pages/justfly/bookingConfirmation.page';

/**
 * Framework fixtures for page objects.
 *
 * Page objects are added per brand area (flighthub / justfly / shared) and
 * registered here as fixtures. Tests then receive them via dependency
 * injection — never `new SomePage(page)` directly.
 *
 * @example Adding a brand page object
 * ```ts
 * import { FlighthubHomePage } from '../../pages/flighthub/home.page';
 *
 * export type FrameworkFixtures = {
 *     flighthubHomePage: FlighthubHomePage;
 *     resetStorageState: () => Promise<void>;
 * };
 *
 * export const test = base.extend<FrameworkFixtures>({
 *     flighthubHomePage: async ({ page }, use) => {
 *         await use(new FlighthubHomePage(page));
 *     },
 *     // ...
 * });
 * ```
 */
export type FrameworkFixtures = {
    /**
     * Clears cookies and permissions to reset the authenticated browser
     * context. Use in `beforeEach` for unauthenticated flows when the
     * project's storageState would otherwise be active.
     */
    resetStorageState: () => Promise<void>;

    /** Flighthub home page (search form). */
    flighthubHomePage: FlighthubHomePage;
    /** Flighthub search-results page (`/flight/search?...`). */
    flighthubSearchResultsPage: FlighthubSearchResultsPage;
    /** Flighthub checkout page (`/flight/checkout/{searchId}/{packageId}`). */
    flighthubCheckoutPage: FlighthubCheckoutPage;
    /** Flighthub post-checkout booking-result page (`/flight/booking/{ref}`). */
    flighthubBookingConfirmationPage: FlighthubBookingConfirmationPage;

    /** JustFly home page (search form). */
    justflyHomePage: JustflyHomePage;
    /** JustFly search-results page (`/flight/search?...`). */
    justflySearchResultsPage: JustflySearchResultsPage;
    /** JustFly checkout page (`/flight/checkout/{searchId}/{packageId}`). */
    justflyCheckoutPage: JustflyCheckoutPage;
    /** JustFly post-checkout booking-result page (`/flight/booking/{ref}`). */
    justflyBookingConfirmationPage: JustflyBookingConfirmationPage;
};

export const test = base.extend<FrameworkFixtures>({
    resetStorageState: async ({ context }, use) => {
        await use(async () => {
            await context.clearCookies();
            await context.clearPermissions();
        });
    },

    flighthubHomePage: async ({ page }, use) => {
        await use(new FlighthubHomePage(page));
    },

    flighthubSearchResultsPage: async ({ page }, use) => {
        await use(new FlighthubSearchResultsPage(page));
    },

    flighthubCheckoutPage: async ({ page }, use) => {
        await use(new FlighthubCheckoutPage(page));
    },

    flighthubBookingConfirmationPage: async ({ page }, use) => {
        await use(new FlighthubBookingConfirmationPage(page));
    },

    justflyHomePage: async ({ page }, use) => {
        await use(new JustflyHomePage(page));
    },

    justflySearchResultsPage: async ({ page }, use) => {
        await use(new JustflySearchResultsPage(page));
    },

    justflyCheckoutPage: async ({ page }, use) => {
        await use(new JustflyCheckoutPage(page));
    },

    justflyBookingConfirmationPage: async ({ page }, use) => {
        await use(new JustflyBookingConfirmationPage(page));
    },
});
