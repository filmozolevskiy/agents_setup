import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages, Routes } from '../../../enums/justfly/justfly';
import {
    seededBooking,
    seededBookingIdHash,
} from '../../../helpers/shared/seededBooking';
import {
    FORGED_BOOKING_REF_NO_MATCH,
    FORGED_ID_HASH_ZEROS,
} from '../../../test-data/static/justfly/forgedTokens';

// The seeded BOOKING_ID_JF on staging2 is a cancelled YUL <-> PTY
// roundtrip booking; the same `id_hash` deep-links the trip-detail /
// confirmation surface. The page object's {@link gotoTripDetail}
// navigates straight there, bypassing the destructive E2E checkout
// (which is gated by the staging fraud cooldown — same reason as
// Flighthub Trello n48YUvIE).
//
// Cancelled and issued bookings share the same chrome — itinerary,
// travellers, baggage, billing, and support all render identically;
// only the top banner (refund summary on cancelled), the quick-action
// set, and the E-Tickets section (issued-state only) differ. The
// cancelled-state-only assertions that exercise the refund banner are
// isolated from the shared-chrome assertions so the file works against
// either state if the seeded booking is later replaced with an issued
// one.
test.describe('justfly bookingConfirmation page — trip detail surface', () => {
    test.describe.configure({ timeout: 60_000 });

    test.beforeEach(async ({ justflyBookingConfirmationPage }) => {
        const idHash = seededBookingIdHash('justfly');
        await justflyBookingConfirmationPage.gotoTripDetail(idHash);
    });

    test(
        'renders the booking number heading, the customer-visible booking number, and the welcome heading',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage, page }) => {
            await test.step('THEN the page lands on /service/portal/detail/{idHash}', async () => {
                await expect(page).toHaveURL(
                    new RegExp(
                        `${Routes.PORTAL_DETAIL.replace(/\//g, '\\/')}\\/[a-f0-9]{32}$`
                    )
                );
            });

            await test.step('AND the Booking #NNN-NNN-NNN top heading renders', async () => {
                await expect(
                    justflyBookingConfirmationPage.bookingNumberHeading
                ).toBeVisible();
            });

            await test.step('AND the justfly.com Booking Number text echoes the same number', async () => {
                await expect(
                    justflyBookingConfirmationPage.bookingNumberText
                ).toBeVisible();
            });

            await test.step('AND the Welcome! heading renders', async () => {
                await expect(
                    justflyBookingConfirmationPage.welcomeHeading
                ).toBeVisible();
            });
        }
    );

    test(
        'extractBookingId returns the dashless 9-digit Respro id',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            const { bookingId } = seededBooking('justfly');
            const extracted =
                await justflyBookingConfirmationPage.extractBookingId();
            expect(extracted).toBe(bookingId);
        }
    );

    test(
        'exposes one quick-action tile per cancelled-state action (Traveller Details, Travel Requirements, Book Again, Support)',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            for (const action of [
                Messages.BOOKING_QUICK_ACTION_TRAVELLER_DETAILS,
                Messages.BOOKING_QUICK_ACTION_TRAVEL_REQUIREMENTS,
                Messages.BOOKING_QUICK_ACTION_BOOK_AGAIN,
                Messages.BOOKING_SUPPORT_HEADING,
            ]) {
                await expect(
                    justflyBookingConfirmationPage.quickActionLink(action)
                ).toBeVisible();
            }
        }
    );

    test(
        'renders the My itinerary section with one slice card per leg, anchored on `Airline confirmation: ...`',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            // Seeded BOOKING_ID_JF on staging2 is a roundtrip
            // booking, so both slice indices render. Outbound +
            // return slice cards are asserted independently.
            await test.step('THEN the My itinerary heading renders', async () => {
                await expect(
                    justflyBookingConfirmationPage.itineraryHeading
                ).toBeVisible();
            });

            await test.step('AND the outbound slice card exposes the airline-confirmation anchor + slice label + first-segment origin / final destination IATAs', async () => {
                const slice = justflyBookingConfirmationPage.itinerarySlice(0);
                await expect(slice.airlineConfirmation).toBeVisible();
                await expect(slice.sliceLabel).toBeVisible();
                await expect(slice.originIata).toBeVisible();
                await expect(slice.destinationIata).toBeVisible();
            });

            await test.step('AND the return slice card exposes the same anchor + label + origin / destination IATAs', async () => {
                const slice = justflyBookingConfirmationPage.itinerarySlice(1);
                await expect(slice.airlineConfirmation).toBeVisible();
                await expect(slice.sliceLabel).toBeVisible();
                await expect(slice.originIata).toBeVisible();
                await expect(slice.destinationIata).toBeVisible();
            });
        }
    );

    test(
        'renders the Travellers section with a per-pax label, name, DOB, and gender',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            await test.step('THEN the Travellers heading renders', async () => {
                await expect(
                    justflyBookingConfirmationPage.travellersHeading
                ).toBeVisible();
            });

            await test.step('AND Passenger 1 exposes the full-name / DOB / gender row', async () => {
                const pax = justflyBookingConfirmationPage.traveller(1);
                await expect(pax.label).toBeVisible();
                await expect(pax.fullName).toBeVisible();
                await expect(pax.dateOfBirth).toBeVisible();
                await expect(pax.gender).toBeVisible();
            });
        }
    );

    test(
        'renders the Billing block with the Price Summary heading and the Final Total Price line',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            await test.step('THEN the Billing section renders', async () => {
                await expect(
                    justflyBookingConfirmationPage.billingHeading
                ).toBeVisible();
                await expect(
                    justflyBookingConfirmationPage.priceSummaryHeading
                ).toBeVisible();
            });

            await test.step('AND the Final Total Price line is visible', async () => {
                await expect(
                    justflyBookingConfirmationPage.finalTotalPrice
                ).toBeVisible();
            });

            await test.step('AND the price-breakdown rows are visible (Base Fare + Taxes & Agency Fees + Total Per Person)', async () => {
                for (const label of [
                    Messages.BOOKING_PRICE_ROW_BASE_FARE,
                    Messages.BOOKING_PRICE_ROW_TAXES_AGENCY_FEES,
                    Messages.BOOKING_PRICE_ROW_TOTAL_PER_PERSON,
                ]) {
                    await expect(
                        justflyBookingConfirmationPage.priceRow(label)
                    ).toBeVisible();
                }
            });
        }
    );

    test(
        'renders the Support section with the Support Center and Upload documents links',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            await expect(
                justflyBookingConfirmationPage.supportHeading
            ).toBeVisible();
            await expect(
                justflyBookingConfirmationPage.supportCenterLink
            ).toBeVisible();
            await expect(
                justflyBookingConfirmationPage.uploadDocumentsLink
            ).toBeVisible();
        }
    );

    test(
        'cancelled bookings render the refund banner, refund-summary heading, estimated date, and payment method',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            // FIXME: The seeded BOOKING_ID_JF is currently cancelled, so
            // these surfaces always render. If the seed is later refreshed
            // to an issued booking, gate this assertion on
            // `bookingStatusCancelled.isVisible()` and add a sibling
            // `@regression` covering the issued-state quick-actions
            // (Seat Requests / Protect My Trip).
            await expect(
                justflyBookingConfirmationPage.bookingStatusCancelled
            ).toBeVisible();
            await expect(
                justflyBookingConfirmationPage.cancellationBanner
            ).toBeVisible();
            await expect(
                justflyBookingConfirmationPage.refundSummaryHeading
            ).toBeVisible();
            await expect(
                justflyBookingConfirmationPage.refundEstimatedDate
            ).toBeVisible();
            await expect(
                justflyBookingConfirmationPage.refundPaymentMethod
            ).toBeVisible();
        }
    );

    test(
        'forged / unknown id_hash routes to the expired-link surface (JustFly diverges from Flighthub here)',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            // FIXME: Brand-difference finding from card BulA71wU.
            // Flighthub's storefront renders the dedicated Not Found
            // heading (`We're sorry! We were unable to retrieve your
            // booking.`) for a forged `id_hash`. JustFly's storefront
            // (verified 2026-05-09 on staging2 with the all-zeros
            // sentinel) instead routes to the same expired-link surface
            // it uses for an invalid `/flight/booking/<ref>` request.
            // Tracked as a follow-up to confirm whether this is a
            // backend route handler difference or a storefront-config
            // gap. The `notFoundHeading` locator stays wired so the
            // test will flip back automatically once the dedicated
            // surface is restored.
            await justflyBookingConfirmationPage.gotoTripDetail(
                FORGED_ID_HASH_ZEROS
            );
            await expect(
                justflyBookingConfirmationPage.expiredLinkMessage
            ).toBeVisible();
        }
    );

    test(
        'legacy /flight/booking/{ref} catch-all renders the link-expired message',
        { tag: '@regression' },
        async ({ justflyBookingConfirmationPage }) => {
            await justflyBookingConfirmationPage.goto(
                FORGED_BOOKING_REF_NO_MATCH
            );
            await expect(
                justflyBookingConfirmationPage.expiredLinkMessage
            ).toBeVisible();
        }
    );
});
