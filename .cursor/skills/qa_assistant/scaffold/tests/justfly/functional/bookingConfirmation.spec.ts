import { expect, test } from '../../../fixtures/pom/test-options';

// Coverage map for the post-booking surface:
//   - Expired-link fallback: this spec (direct-load is the only sensible
//     entry-point — there is no booking on file).
//   - Success state (heading + booking reference): asserted inline by the
//     @destructive E2E in `tests/justfly/e2e/checkoutFlow.spec.ts` against
//     the freshly-created booking; no static fixture is feasible because
//     the storefront's signed `/service/portal/detail/<token>?signature=<jwt>`
//     URL has a short-lived JWT and the legacy `/flight/booking/<ref>` route
//     is deprecated (always renders "link expired"). Mirrors the Flighthub
//     bookingConfirmation coverage map (Trello n48YUvIE).
//   - Trip-detail surface coverage against the seeded booking lives in
//     `tests/justfly/functional/bookingConfirmationDetail.spec.ts`.

test.describe('justfly booking-result page', () => {
    test(
        'invalid booking reference renders the expired-link fallback',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            await test.step('GIVEN the user opens a booking URL with an invalid reference', async () => {
                await justflyBookingConfirmationPage.goto(
                    'invalid-booking-ref'
                );
            });

            await test.step('THEN the expired-link message is displayed', async () => {
                await expect(
                    justflyBookingConfirmationPage.expiredLinkMessage
                ).toBeVisible();
            });
        }
    );
});
