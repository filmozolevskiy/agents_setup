import { Locator, Page } from '@playwright/test';
import { Messages, Routes } from '../../enums/justfly/justfly';

/**
 * Per-traveller locator bundle returned by {@link JustflyBookingConfirmationPage.traveller}.
 *
 * The Travellers section renders one `<li>` per pax containing the
 * `Passenger N` label, the full name, the date of birth, and the gender —
 * the e-ticket number lives in a separate `E-Tickets` section keyed by
 * the same name (see {@link JustflyBookingConfirmationPage.eTicketRow}).
 */
export interface JustflyBookingTravellerLocators {
    label: Locator;
    fullName: Locator;
    dateOfBirth: Locator;
    gender: Locator;
}

/**
 * Per-leg locator bundle returned by {@link JustflyBookingConfirmationPage.itinerarySlice}.
 *
 * The `My itinerary` section renders one card per slice (`Departure`,
 * `Return`, ...). Each card hosts a stable `Airline confirmation: ...`
 * label and the first-segment origin / last-segment destination IATA
 * codes — multi-segment legs render every segment in the same card, so
 * trip-level origin / destination resolve to the first / last 3-letter
 * IATA token in DOM order.
 */
export interface JustflyBookingSliceLocators {
    card: Locator;
    sliceLabel: Locator;
    airlineConfirmation: Locator;
    originIata: Locator;
    destinationIata: Locator;
}

/**
 * Page object for two distinct post-checkout surfaces on JustFly:
 *
 *   1. **Trip detail / confirmation** at `Routes.PORTAL_DETAIL/{idHash}` —
 *      where the storefront redirects after a successful "Confirm and Book"
 *      and where customers land from the email "view your booking" link.
 *      `idHash` is the `bookings.id_hash` column (32-char lowercase hex)
 *      and is opaque from the test's perspective; tests resolve it from
 *      `seededBookingIdHash('justfly')` (see `helpers/shared/seededBooking.ts`).
 *
 *      The same surface renders for issued and cancelled bookings — only
 *      the top banner (refund summary on cancelled) and the quick-action
 *      set differ. Booking-status text disambiguates the two states.
 *
 *      Used by the @destructive E2E in
 *      `tests/justfly/e2e/checkoutFlow.spec.ts` (booking-id capture for
 *      Respro cleanup) and by
 *      `tests/justfly/functional/bookingConfirmationDetail.spec.ts`
 *      (locator-coverage regression against the seeded booking).
 *
 *   2. **Legacy `/flight/booking/{ref}` link** — a catch-all that always
 *      renders "link expired" for invalid refs. Reached via {@link goto}.
 */
export class JustflyBookingConfirmationPage {
    constructor(private readonly page: Page) {}

    // ==================== Header / status ====================

    get bookingNumberHeading(): Locator {
        return this.page.getByText(/Booking #\d{3}-\d{3}-\d{3}/);
    }

    get bookingNumberText(): Locator {
        return this.page.getByText(
            new RegExp(
                `${Messages.BOOKING_NUMBER_LABEL}\\s+\\d{3}-\\d{3}-\\d{3}`
            )
        );
    }

    get welcomeHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_WELCOME_HEADING, {
            exact: true,
        });
    }

    get bookingStatusConfirmed(): Locator {
        return this.page.getByText(Messages.BOOKING_STATUS_CONFIRMED, {
            exact: true,
        });
    }

    get bookingStatusCancelled(): Locator {
        return this.page.getByText(Messages.BOOKING_STATUS_CANCELLED, {
            exact: true,
        });
    }

    get confirmedBanner(): Locator {
        return this.page.getByText(Messages.BOOKING_CONFIRMED_BANNER, {
            exact: true,
        });
    }

    // ==================== Top-bar action links ====================

    get printLink(): Locator {
        return this.page.getByRole('link', {
            name: Messages.BOOKING_PRINT_LINK,
            exact: true,
        });
    }

    // JustFly does not always render the Share link on cancelled bookings
    // (verified 2026-05-09 on staging2 — only Print + Download invoice
    // appear). Locator stays wired so issued-state coverage can assert it.
    get shareLink(): Locator {
        return this.page.getByRole('link', {
            name: Messages.BOOKING_SHARE_LINK,
            exact: true,
        });
    }

    get downloadInvoiceLink(): Locator {
        return this.page.getByRole('link', {
            name: Messages.BOOKING_DOWNLOAD_INVOICE_LINK,
            exact: true,
        });
    }

    // ==================== Quick-action menu ====================

    quickActionLink(name: Messages | (string & Record<never, never>)): Locator {
        // Scope to the trip-detail page container — the global header
        // also renders a `Support` link (`/service/help`) which would
        // strict-mode-collide with the `Support` quick-action tile
        // (`#supportSection`). The `#detailsPage` wrapper is stable
        // across both brands (verified 2026-05-09 on staging2). Other
        // tile names (Hotels, Travel Requirements, Book Again, ...)
        // do not collide today, but scoping consistently future-proofs
        // every tile against header drift.
        /* eslint-disable playwright/no-raw-locators -- the trip-detail container has no semantic role; #detailsPage is the only stable scope that excludes the global header. */
        return this.page
            .locator('#detailsPage')
            .getByRole('link', { name, exact: true });
        /* eslint-enable playwright/no-raw-locators */
    }

    // ==================== Cancelled-state refund banner ====================

    get cancellationBanner(): Locator {
        // The storefront renders this banner with a curly apostrophe in
        // `haven't` while some browsers normalize it back to a straight
        // apostrophe — match a stable prefix that does not depend on
        // the apostrophe so the locator is resilient to that drift.
        return this.page.getByText(
            /^We have successfully processed your cancellation request\./
        );
    }

    get refundSummaryHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_REFUND_SUMMARY_HEADING, {
            exact: true,
        });
    }

    get refundEstimatedDate(): Locator {
        return this.page.getByText(
            new RegExp(`${Messages.BOOKING_REFUND_ESTIMATED_DATE_PREFIX}`)
        );
    }

    get refundPaymentMethod(): Locator {
        return this.page.getByText(
            new RegExp(`${Messages.BOOKING_REFUND_PAYMENT_METHOD_PREFIX}`)
        );
    }

    // ==================== My itinerary ====================

    get itineraryHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_ITINERARY_HEADING, {
            exact: true,
        });
    }

    itinerarySlice(sliceIdx: number): JustflyBookingSliceLocators {
        const airlineConfirmation = this.page
            .getByText(
                new RegExp(
                    `${Messages.BOOKING_ITINERARY_AIRLINE_CONFIRMATION_PREFIX}`
                )
            )
            .nth(sliceIdx); // eslint-disable-line playwright/no-nth-methods -- one airline-confirmation label per slice; index pins to leg.
        // The slice card is the third-degree ancestor of the
        // `Airline confirmation: ...` text. The label is wrapped twice
        // by styled-component spans before reaching the slice header,
        // and the header is a sibling of the slice body — three
        // ancestor hops reach the wrapper containing both halves
        // (verified 2026-05-09 via the staging2 trip-detail snapshot;
        // identical depth to Flighthub since both brands ship the same
        // genesis-storefront codebase).
        const card = airlineConfirmation.locator('xpath=ancestor::*[3]'); // eslint-disable-line playwright/no-raw-locators -- styled-component slice card has no semantic role; xpath ancestor walk is the only stable anchor.

        return {
            card,
            sliceLabel: card
                .getByText(
                    new RegExp(
                        `^(${Messages.BOOKING_ITINERARY_SLICE_DEPARTURE}|${Messages.BOOKING_ITINERARY_SLICE_RETURN})$`
                    )
                )
                .first(), // eslint-disable-line playwright/no-nth-methods -- slice header is the first label match within the scoped card.
            airlineConfirmation,
            originIata: card.getByText(/^[A-Z]{3}$/).first(), // eslint-disable-line playwright/no-nth-methods -- multi-segment legs render every segment IATA; origin is the first 3-letter token in DOM order.
            destinationIata: card.getByText(/^[A-Z]{3}$/).last(), // eslint-disable-line playwright/no-nth-methods -- multi-segment legs render every segment IATA; final destination is the last 3-letter token.
        };
    }

    // ==================== Flight enhancers / baggage ====================

    get flightEnhancersHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_FLIGHT_ENHANCERS_HEADING, {
            exact: true,
        });
    }

    get baggageInformationHeading(): Locator {
        return this.page.getByText(Messages.CHECKOUT_BAGGAGE_INFO_BUTTON, {
            exact: true,
        });
    }

    baggageRow(routeLabel: string): Locator {
        return this.page.getByText(routeLabel, { exact: true });
    }

    // ==================== Flight information / fare rules ====================

    get flightInformationHeading(): Locator {
        return this.page.getByText(
            Messages.BOOKING_FLIGHT_INFORMATION_HEADING,
            { exact: true }
        );
    }

    get fareRulesHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_FARE_RULES_HEADING, {
            exact: true,
        });
    }

    // ==================== Travellers + e-tickets ====================

    get travellersHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_TRAVELLERS_HEADING, {
            exact: true,
        });
    }

    traveller(idx: number): JustflyBookingTravellerLocators {
        const label = this.page.getByText(
            `${Messages.CHECKOUT_PASSENGER_HEADING_PREFIX}${idx}`,
            { exact: true }
        );
        const row = label.locator('xpath=ancestor::li[1]'); // eslint-disable-line playwright/no-raw-locators -- listitem has no semantic role exposed under getByRole; closest <li> ancestor is the only stable scoping anchor.

        return {
            label,
            // The storefront renders DOB without zero-padding (e.g.
            // `6/17/1948`, not `06/17/1948`); allow 1- or 2-digit
            // month/day. Two- or three-token names are both valid.
            fullName: row
                .getByText(/^[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)+$/)
                .first(), // eslint-disable-line playwright/no-nth-methods -- the full name is the first multi-word capitalized text node within the row.
            dateOfBirth: row.getByText(/^\d{1,2}\/\d{1,2}\/\d{4}$/),
            gender: row.getByText(/^(Male|Female|Non-binary)$/),
        };
    }

    get eTicketsHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_E_TICKETS_HEADING, {
            exact: true,
        });
    }

    eTicketRow(travellerName: string): Locator {
        const nameCell = this.page.getByText(travellerName, { exact: true });
        /* eslint-disable playwright/no-raw-locators -- e-ticket grid row has no semantic role. */
        return nameCell.locator('..');
        /* eslint-enable playwright/no-raw-locators */
    }

    eTicketNumberFor(travellerName: string): Locator {
        return this.eTicketRow(travellerName).getByText(/^#\d{3}-\d+$/);
    }

    // ==================== Travel requirements ====================

    get travelRequirementsHeading(): Locator {
        return this.page.getByText(
            Messages.BOOKING_TRAVEL_REQUIREMENTS_HEADING,
            { exact: true }
        );
    }

    get applyForVisaButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.BOOKING_TRAVEL_VISA_BUTTON,
            exact: true,
        });
    }

    get viewTravelRequirementsButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.CHECKOUT_VISA_REQUIREMENTS_LINK,
            exact: true,
        });
    }

    // ==================== Billing / price summary ====================

    get billingHeading(): Locator {
        return this.page.getByText(Messages.BOOKING_BILLING_HEADING, {
            exact: true,
        });
    }

    get priceSummaryHeading(): Locator {
        return this.page.getByText(Messages.CHECKOUT_PRICE_SUMMARY_HEADING, {
            exact: true,
        });
    }

    get priceDownloadButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.BOOKING_PRICE_DOWNLOAD,
            exact: true,
        });
    }

    get priceEmailButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.BOOKING_PRICE_EMAIL,
            exact: true,
        });
    }

    priceRow(label: string): Locator {
        return this.page.getByText(label, { exact: true }).first(); // eslint-disable-line playwright/no-nth-methods -- multi-pax bookings repeat the same row label per pax sub-block; first() pins the leading subtotal.
    }

    get finalTotalPrice(): Locator {
        return this.page.getByText(Messages.BOOKING_PRICE_FINAL_TOTAL, {
            exact: true,
        });
    }

    // ==================== Support ====================

    get supportHeading(): Locator {
        // The right-rail Support section heading and the quick-action
        // tile both render the literal text `Support`. The right-rail
        // heading comes second in DOM order; last() pins the heading.
        return this.page
            .getByText(Messages.BOOKING_SUPPORT_HEADING, { exact: true })
            .last(); // eslint-disable-line playwright/no-nth-methods -- two literal `Support` text nodes (quick-action tile + right-rail heading); last() targets the heading.
    }

    get supportCenterLink(): Locator {
        return this.page.getByRole('link', {
            name: Messages.BOOKING_SUPPORT_CENTER_LINK,
            exact: true,
        });
    }

    get uploadDocumentsLink(): Locator {
        return this.page.getByRole('link', {
            name: Messages.BOOKING_SUPPORT_UPLOAD_DOCUMENTS_LINK,
            exact: true,
        });
    }

    // ==================== Not-found ====================

    get notFoundHeading(): Locator {
        return this.page.getByRole('heading', {
            name: Messages.BOOKING_NOT_FOUND_HEADING,
            level: 2,
        });
    }

    // ==================== Legacy /flight/booking ====================

    get expiredLinkMessage(): Locator {
        return this.page.getByText(Messages.BOOKING_LINK_EXPIRED, {
            exact: true,
        });
    }

    // ==================== Actions ====================

    /**
     * Navigates to the legacy booking-result route for a given reference.
     * The route is a catch-all that always renders the "link expired"
     * page for an arbitrary reference — kept for the negative-path
     * regression that asserts the expired surface.
     *
     * @param reference - Booking reference / id (path segment).
     */
    async goto(reference: string): Promise<void> {
        await this.page.goto(`${Routes.FLIGHT_BOOKING}/${reference}`);
    }

    /**
     * Navigates directly to the trip-detail surface for a given booking
     * `id_hash` (the 32-char `bookings.id_hash` column). Tests typically
     * source the hash from `seededBookingIdHash('justfly')` rather than
     * hard-coding.
     *
     * @param idHash 32-char lowercase hex `bookings.id_hash`.
     */
    async gotoTripDetail(idHash: string): Promise<void> {
        await this.page.goto(`${Routes.PORTAL_DETAIL}/${idHash}`);
    }

    /**
     * Reads the customer-visible booking number (`NNN-NNN-NNN`) from the
     * top-of-page heading and returns the dashless 9-digit form expected
     * by Respro (`/booking/index/<id>`).
     *
     * @returns Dashless numeric Respro booking id.
     * @throws If the heading cannot be parsed (caller is on the wrong URL).
     */
    async extractBookingId(): Promise<string> {
        const heading = await this.bookingNumberHeading.textContent();
        const match = heading?.match(/(\d{3}-\d{3}-\d{3})/);
        if (!match) {
            throw new Error(
                `Could not extract booking number from heading: "${heading}"`
            );
        }
        return match[1].replace(/-/g, '');
    }

    /**
     * Reads the `Final Total Price` line and returns the trailing
     * currency + amount as displayed (e.g. `'CAD 1,451.42'`). Useful for
     * asserting the cart total survives the redirect from checkout.
     *
     * @throws If the row is not visible or the amount cannot be parsed.
     */
    async extractFinalTotalPrice(): Promise<string> {
        /* eslint-disable playwright/no-raw-locators -- amount sits in a sibling node of the label; xpath is the smallest stable expression. */
        const amount = this.finalTotalPrice.locator(
            'xpath=following-sibling::*[1]'
        );
        /* eslint-enable playwright/no-raw-locators */
        const text = (await amount.textContent())?.trim();
        if (!text) {
            throw new Error(
                'Could not read Final Total Price amount — the Billing block may not be rendered.'
            );
        }
        return text;
    }
}
