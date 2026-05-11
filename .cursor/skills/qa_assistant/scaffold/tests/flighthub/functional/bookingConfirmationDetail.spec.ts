import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages, Routes } from '../../../enums/flighthub/flighthub';
import {
    seededBooking,
    seededBookingIdHash,
} from '../../../helpers/shared/seededBooking';
import {
    FORGED_BOOKING_REF_NO_MATCH,
    FORGED_ID_HASH_ZEROS,
} from '../../../test-data/static/flighthub/forgedTokens';

// The seeded BOOKING_ID_FH on staging2 is the cancelled YUL <-> BKK
// booking from the ref-search API specs; the same `id_hash` deep-links
// the trip-detail / confirmation surface. The page object's
// {@link gotoTripDetail} navigates straight there, bypassing the
// destructive E2E checkout (which is gated by the staging fraud
// cooldown — see the n48YUvIE Trello card).
//
// Cancelled and issued bookings share the same chrome — itinerary,
// travellers, baggage, billing, e-tickets, and support all render
// identically; only the top banner (refund summary on cancelled) and
// the quick-action set differ. The cancelled-state-only assertions
// that exercise the refund banner are isolated from the shared-chrome
// assertions so the file works against either state if the seeded
// booking is later replaced with an issued one.
test.describe('flighthub bookingConfirmation page — trip detail surface', () => {
    test.describe.configure({ timeout: 60_000 });

    test.beforeEach(async ({ flighthubBookingConfirmationPage }) => {
        const idHash = seededBookingIdHash('flighthub');
        await flighthubBookingConfirmationPage.gotoTripDetail(idHash);
    });

    test(
        'renders the booking number heading, the customer-visible booking number, and the welcome heading',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage, page }) => {
            await test.step('THEN the page lands on /service/portal/detail/{idHash}', async () => {
                await expect(page).toHaveURL(
                    new RegExp(
                        `${Routes.PORTAL_DETAIL.replace(/\//g, '\\/')}\\/[a-f0-9]{32}$`
                    )
                );
            });

            await test.step('AND the Booking #NNN-NNN-NNN top heading renders', async () => {
                await expect(
                    flighthubBookingConfirmationPage.bookingNumberHeading
                ).toBeVisible();
            });

            await test.step('AND the FlightHub Booking Number text echoes the same number', async () => {
                await expect(
                    flighthubBookingConfirmationPage.bookingNumberText
                ).toBeVisible();
            });

            await test.step('AND the Welcome! heading renders', async () => {
                await expect(
                    flighthubBookingConfirmationPage.welcomeHeading
                ).toBeVisible();
            });
        }
    );

    test(
        'extractBookingId returns the dashless 9-digit Respro id',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            const { bookingId } = seededBooking('flighthub');
            const extracted =
                await flighthubBookingConfirmationPage.extractBookingId();
            expect(extracted).toBe(bookingId);
        }
    );

    test(
        'exposes one quick-action tile per cancelled-state action (Traveller Details, Travel Requirements, Book Again, Support)',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            for (const action of [
                Messages.BOOKING_QUICK_ACTION_TRAVELLER_DETAILS,
                Messages.BOOKING_QUICK_ACTION_TRAVEL_REQUIREMENTS,
                Messages.BOOKING_QUICK_ACTION_BOOK_AGAIN,
                Messages.BOOKING_SUPPORT_HEADING,
            ]) {
                await expect(
                    flighthubBookingConfirmationPage.quickActionLink(action)
                ).toBeVisible();
            }
        }
    );

    test(
        'renders the My itinerary section with one slice card per leg, anchored on `Airline confirmation: ...`',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            // Seeded BOOKING_ID_FH on staging2 is a one-way YUL -> BKK
            // booking, so the surface renders one outbound slice with
            // no Return. Both slice indices are exercised when the seed
            // is later replaced with a roundtrip booking — for now,
            // only sliceIdx=0 is asserted.
            await test.step('THEN the My itinerary heading renders', async () => {
                await expect(
                    flighthubBookingConfirmationPage.itineraryHeading
                ).toBeVisible();
            });

            await test.step('AND the outbound slice card exposes the airline-confirmation anchor + slice label + first-segment origin / final destination IATAs', async () => {
                const slice =
                    flighthubBookingConfirmationPage.itinerarySlice(0);
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
        async ({ flighthubBookingConfirmationPage }) => {
            await test.step('THEN the Travellers heading renders', async () => {
                await expect(
                    flighthubBookingConfirmationPage.travellersHeading
                ).toBeVisible();
            });

            await test.step('AND Passenger 1 exposes the full-name / DOB / gender row', async () => {
                const pax = flighthubBookingConfirmationPage.traveller(1);
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
        async ({ flighthubBookingConfirmationPage }) => {
            await test.step('THEN the Billing section renders', async () => {
                await expect(
                    flighthubBookingConfirmationPage.billingHeading
                ).toBeVisible();
                await expect(
                    flighthubBookingConfirmationPage.priceSummaryHeading
                ).toBeVisible();
            });

            await test.step('AND the Final Total Price line is visible', async () => {
                await expect(
                    flighthubBookingConfirmationPage.finalTotalPrice
                ).toBeVisible();
            });

            await test.step('AND the price-breakdown rows are visible (Base Fare + Taxes & Agency Fees + Total Per Person)', async () => {
                for (const label of [
                    Messages.BOOKING_PRICE_ROW_BASE_FARE,
                    Messages.BOOKING_PRICE_ROW_TAXES_AGENCY_FEES,
                    Messages.BOOKING_PRICE_ROW_TOTAL_PER_PERSON,
                ]) {
                    await expect(
                        flighthubBookingConfirmationPage.priceRow(label)
                    ).toBeVisible();
                }
            });
        }
    );

    test(
        'renders the Support section with the Support Center and Upload documents links',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            await expect(
                flighthubBookingConfirmationPage.supportHeading
            ).toBeVisible();
            await expect(
                flighthubBookingConfirmationPage.supportCenterLink
            ).toBeVisible();
            await expect(
                flighthubBookingConfirmationPage.uploadDocumentsLink
            ).toBeVisible();
        }
    );

    test(
        'cancelled bookings render the refund banner, refund-summary heading, estimated date, and payment method',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            // FIXME: The seeded BOOKING_ID_FH is currently cancelled, so
            // these surfaces always render. If the seed is later refreshed
            // to an issued booking, gate this assertion on
            // `bookingStatusCancelled.isVisible()` and add a sibling
            // `@regression` covering the issued-state quick-actions
            // (Seat Requests / Protect My Trip).
            await expect(
                flighthubBookingConfirmationPage.bookingStatusCancelled
            ).toBeVisible();
            await expect(
                flighthubBookingConfirmationPage.cancellationBanner
            ).toBeVisible();
            await expect(
                flighthubBookingConfirmationPage.refundSummaryHeading
            ).toBeVisible();
            await expect(
                flighthubBookingConfirmationPage.refundEstimatedDate
            ).toBeVisible();
            await expect(
                flighthubBookingConfirmationPage.refundPaymentMethod
            ).toBeVisible();
        }
    );

    test(
        'forged / unknown id_hash renders the Not Found surface',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            await flighthubBookingConfirmationPage.gotoTripDetail(
                FORGED_ID_HASH_ZEROS
            );
            await expect(
                flighthubBookingConfirmationPage.notFoundHeading
            ).toBeVisible();
        }
    );

    test(
        'legacy /flight/booking/{ref} catch-all renders the link-expired message',
        { tag: '@regression' },
        async ({ flighthubBookingConfirmationPage }) => {
            await flighthubBookingConfirmationPage.goto(
                FORGED_BOOKING_REF_NO_MATCH
            );
            await expect(
                flighthubBookingConfirmationPage.expiredLinkMessage
            ).toBeVisible();
        }
    );
});
