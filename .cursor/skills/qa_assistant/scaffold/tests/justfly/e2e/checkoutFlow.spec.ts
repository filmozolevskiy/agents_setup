import { expect, test } from '../../../fixtures/pom/test-options';
import { Routes } from '../../../enums/justfly/justfly';
import { Timeouts } from '../../../enums/util/timeouts';
import { generateOneWaySearch } from '../../../test-data/factories/justfly/search.factory';
import { generateAdultPassenger } from '../../../test-data/factories/justfly/passenger.factory';
import { generateStagingPayment } from '../../../test-data/factories/justfly/payment.factory';

test.describe('justfly end-to-end checkout flow', () => {
    // Live GDS search + bundle/fare modals + Confirm-and-Book payment +
    // Respro abort each routinely take 30-90s on staging2; budget four
    // minutes for the full destructive flow + cleanup.
    test.describe.configure({ timeout: Timeouts.DESTRUCTIVE_E2E_MS });

    // KNOWN LIMITATION (mirrors Flighthub equivalent): staging2's
    // front-line Fraud Prevention API tracks repeat charges from the
    // Stripe 4242 test BIN and blocks them with "Credit Card check
    // failed" within ~10 minutes of a prior attempt — unrelated to the
    // test scaffold. The `useConnexPayMerchant()` step below pins the
    // staging "Default Merchant" debug combobox to ConnexPay as the
    // documented mitigation (routes through ConnexPay's anti-fraud
    // instead), but it is best-effort: empirical re-runs inside the
    // cooldown window can still fail at "Confirm and Book".
    // `@destructive` is intended for nightly runs where the cooldown
    // is not an issue.

    let capturedBookingId: string | null = null;

    test.afterEach(async ({ cancelBookingViaRespro }) => {
        if (capturedBookingId) {
            await cancelBookingViaRespro(capturedBookingId);
            capturedBookingId = null;
        }
    });

    test(
        'completes a one-way booking and exposes the booking reference for cleanup',
        { tag: '@destructive' },
        async ({
            justflyHomePage,
            justflySearchResultsPage,
            justflyCheckoutPage,
            justflyBookingConfirmationPage,
            page,
        }) => {
            // adults: 1 keeps a single Passenger row — multiple rows
            // would strict-mode collide on the shared field IDs.
            const search = generateOneWaySearch({
                origin: 'YUL',
                destination: 'JFK',
                adults: 1,
            });
            const passenger = generateAdultPassenger();
            const payment = generateStagingPayment();

            await test.step('GIVEN the user submits a one-way search', async () => {
                await justflyHomePage.submitOneWaySearch(search);
            });

            await test.step('AND selects the first result through the bundle / fare-upgrade modals', async () => {
                await justflySearchResultsPage.selectFirstResult({
                    resultsTimeoutMs: Timeouts.LIVE_GDS_NAV_MS,
                });
                await expect(page).toHaveURL(
                    /\/checkout\/billing\/flight\/[a-f0-9]+\/[a-f0-9]+/,
                    { timeout: Timeouts.LIVE_GDS_NAV_MS }
                );
            });

            await test.step('AND fills passenger details + ticket-delivery email', async () => {
                await justflyCheckoutPage.fillPassengerOne(passenger);
            });

            await test.step('AND continues to the payment surface', async () => {
                await justflyCheckoutPage.continueToPayment();
            });

            await test.step('AND fills the payment + billing form', async () => {
                await justflyCheckoutPage.fillPaymentAndBilling(payment);
            });

            await test.step('AND pins the staging Default Merchant to ConnexPay (bypasses repeat-BIN fraud block)', async () => {
                await justflyCheckoutPage.useConnexPayMerchant();
            });

            await test.step('WHEN "Confirm and Book" is pressed', async () => {
                await justflyCheckoutPage.submitBookingAndAwaitConfirmation();
            });

            await test.step('THEN the trip-detail page renders the booking number and confirmation banner', async () => {
                await expect(page).toHaveURL(
                    new RegExp(`${Routes.PORTAL_DETAIL}/[a-f0-9]+`),
                    { timeout: Timeouts.LIVE_GDS_NAV_MS }
                );
                await expect(
                    justflyBookingConfirmationPage.bookingNumberHeading
                ).toBeVisible({ timeout: Timeouts.LIVE_GDS_NAV_MS });
                await expect(
                    justflyBookingConfirmationPage.bookingNumberText
                ).toBeVisible();
                await expect(
                    justflyBookingConfirmationPage.confirmedBanner
                ).toBeVisible();
            });

            await test.step('AND the booking number can be extracted for Respro cleanup', async () => {
                capturedBookingId =
                    await justflyBookingConfirmationPage.extractBookingId();
                expect(capturedBookingId).toMatch(/^\d{9}$/);
            });
        }
    );
});
