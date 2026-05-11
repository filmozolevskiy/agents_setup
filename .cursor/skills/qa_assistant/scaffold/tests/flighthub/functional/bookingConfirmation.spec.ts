import { expect, test } from '../../../fixtures/pom/test-options';

// Coverage map for the post-booking surface:
//   - Expired-link fallback: this spec (direct-load is the only sensible
//     entry-point — there is no booking on file).
//   - Success state (heading + booking reference): asserted inline by the
//     @destructive E2E in `tests/flighthub/e2e/checkoutFlow.spec.ts` against
//     the freshly-created booking; no static fixture is feasible because the
//     storefront's signed `/service/portal/detail/<token>?signature=<jwt>`
//     URL has a short-lived JWT and the legacy `/flight/booking/<ref>` route
//     is deprecated (always renders "link expired"). Verified live during
//     https://trello.com/c/e3Uq1uUp.
//   - Failure / pending states: tracked separately as
//     https://trello.com/c/4khizN2O — must be driven through the same
//     @destructive E2E spine, parameterized over the staging "Booking
//     Failure Reason" debug combobox.

test.describe('flighthub booking-result page', () => {
    test(
        'invalid booking reference renders the expired-link fallback',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            await test.step('GIVEN the user opens a booking URL with an invalid reference', async () => {
                await flighthubBookingConfirmationPage.goto(
                    'invalid-booking-ref'
                );
            });

            await test.step('THEN the expired-link message is displayed', async () => {
                await expect(
                    flighthubBookingConfirmationPage.expiredLinkMessage
                ).toBeVisible();
            });
        }
    );
});
