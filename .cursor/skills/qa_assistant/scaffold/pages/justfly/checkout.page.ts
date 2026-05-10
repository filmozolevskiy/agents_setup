import { Locator, Page, expect } from '@playwright/test';
import { Messages, Routes } from '../../enums/justfly/justfly';
import { Timeouts } from '../../enums/util/timeouts';
import type { JustflyPassenger } from '../../test-data/factories/justfly/passenger.factory';
import type { JustflyPassport } from '../../test-data/factories/justfly/passport.factory';
import type { JustflyPayment } from '../../test-data/factories/justfly/payment.factory';
import type { EmptyFormValidationField } from '../../test-data/static/justfly/invalidCheckoutInputs';

/**
 * Insurance / add-on tier shown on the checkout passenger surface.
 * Each tier renders as an independent radiogroup with one accept and
 * one decline radio. Shared genesis-storefront codebase between
 * Flighthub and JustFly — same tier set on both brands.
 */
export type JustflyInsuranceTier = 'cancellation' | 'travel' | 'baggage';

/**
 * Every insurance tier in storefront-render order. Use this in tests
 * that loop over all three tiers (e.g. `decline every add-on` setups
 * before advancing to the payment surface).
 */
export const INSURANCE_TIERS: readonly JustflyInsuranceTier[] = [
    'cancellation',
    'travel',
    'baggage',
] as const;

/**
 * Insurance accept / decline choice. The accept side captures the
 * "Yes, I want ..." radio for the named tier; the decline side captures
 * the matching "No, ..." radio. Both are exposed so tests can assert
 * either branch without re-naming individual radio strings.
 */
export type JustflyInsuranceChoice = 'accept' | 'decline';

/**
 * Per-pax sub-locators returned by `JustflyCheckoutPage.passenger(idx)`.
 * `phone` is exposed on every index but only Passenger 1 has a real
 * phone field on the storefront — for `idx >= 2` it returns a stable
 * `count: 0` locator so callers can `expect(...).toHaveCount(0)`. The
 * `passport*` and `nationality` fields target the international-only
 * passport block which the storefront elides on routes that don't
 * require travel documents (verified — does not render on staging2's
 * YUL <-> LHR even though the route is international); see the
 * `passportBlockVisible` action.
 */
export interface JustflyPassengerLocators {
    heading: Locator;
    firstNameInput: Locator;
    surnameInput: Locator;
    dateOfBirthInput: Locator;
    genderSelect: Locator;
    phoneInput: Locator;
    passportNumberInput: Locator;
    passportExpiryInput: Locator;
    passportIssuingCountrySelect: Locator;
    nationalitySelect: Locator;
}

/**
 * Page object for the JustFly checkout flow. JustFly shares the
 * genesis-storefront codebase with Flighthub, so the surface mirrors
 * `FlighthubCheckoutPage` one-to-one.
 *
 * Covers two URL surfaces:
 *
 *   1. **Real checkout** at `Routes.FLIGHT_CHECKOUT/{searchId}/{packageId}`,
 *      reached through the bundle / fare-upgrade modals on
 *      `searchResults.page`. Locators cover the multi-pax passenger
 *      form, ticket-delivery, optional passport block, insurance /
 *      add-on tiers, payment / billing form, billing-address Google
 *      Places autocomplete, cart summary (price rows, promo code),
 *      itinerary recap, fare-rules link + booking-terms list, the
 *      staging "Debugging Options" panel, and the "Continue to payment"
 *      / "Confirm and Book" CTAs.
 *   2. **Expired-link fallback** at `Routes.FLIGHT_CHECKOUT_FALLBACK/...`,
 *      a catch-all that always renders "link expired". Used by negative
 *      tests via `gotoFallback`.
 */
export class JustflyCheckoutPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators — passenger form (multi-pax) ====================

    passenger(idx: number): JustflyPassengerLocators {
        const prefix = `#p${idx}_`;
        return {
            heading: this.page.getByRole('heading', {
                name: `${Messages.CHECKOUT_PASSENGER_HEADING_PREFIX}${idx}`,
                level: 3,
            }),
            // eslint-disable-next-line playwright/no-raw-locators -- billing field shares accessible name; id is stable.
            firstNameInput: this.page.locator(`${prefix}first_name`),
            // eslint-disable-next-line playwright/no-raw-locators -- billing field shares accessible name; id is stable.
            surnameInput: this.page.locator(`${prefix}last_name`),
            // eslint-disable-next-line playwright/no-raw-locators -- billing field shares accessible name; id is stable.
            dateOfBirthInput: this.page.locator(`${prefix}dob`),
            // eslint-disable-next-line playwright/no-raw-locators -- billing field shares accessible name; id is stable.
            genderSelect: this.page.locator(`${prefix}gender`),
            phoneInput:
                idx === 1
                    ? // eslint-disable-next-line playwright/no-raw-locators -- collides with #billing_phone; id is stable.
                      this.page.locator('#mobile_phone')
                    : // eslint-disable-next-line playwright/no-raw-locators -- non-existent id is the explicit "no phone" sentinel.
                      this.page.locator(`${prefix}phone_does_not_exist`),
            // eslint-disable-next-line playwright/no-raw-locators -- staging-conditional passport block; id is stable when present.
            passportNumberInput: this.page.locator(`${prefix}passport_number`),
            // eslint-disable-next-line playwright/no-raw-locators -- staging-conditional passport block; id is stable when present.
            passportExpiryInput: this.page.locator(`${prefix}passport_expiry`),
            // eslint-disable-next-line playwright/no-raw-locators -- staging-conditional passport block; id is stable when present.
            passportIssuingCountrySelect: this.page.locator(
                `${prefix}passport_issuing_country`
            ),
            // eslint-disable-next-line playwright/no-raw-locators -- staging-conditional passport block; id is stable when present.
            nationalitySelect: this.page.locator(`${prefix}nationality`),
        };
    }

    // ==================== Locators — passenger 1 (compatibility shim) ====================

    get passenger1Heading(): Locator {
        return this.passenger(1).heading;
    }

    get passenger1FirstNameInput(): Locator {
        return this.passenger(1).firstNameInput;
    }

    get passenger1SurnameInput(): Locator {
        return this.passenger(1).surnameInput;
    }

    get passenger1DateOfBirthInput(): Locator {
        return this.passenger(1).dateOfBirthInput;
    }

    get passenger1GenderSelect(): Locator {
        return this.passenger(1).genderSelect;
    }

    get passenger1PhoneInput(): Locator {
        return this.passenger(1).phoneInput;
    }

    // ==================== Locators — ticket delivery ====================

    get ticketDeliveryHeading(): Locator {
        return this.page.getByRole('heading', {
            name: Messages.CHECKOUT_TICKET_DELIVERY_HEADING,
            level: 3,
        });
    }

    get emailInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- collides with hidden login-modal email input; id is stable.
        return this.page.locator('#cc_email');
    }

    get continueAsGuestRadio(): Locator {
        return this.page.getByRole('radio', { name: 'Continue as guest' });
    }

    // ==================== Locators — visa requirements ====================

    get visaRequirementsHeading(): Locator {
        return this.page.getByRole('heading', {
            name: Messages.CHECKOUT_VISA_REQUIREMENTS_HEADING,
            level: 3,
        });
    }

    get visaRequirementsLink(): Locator {
        return this.page.getByRole('link', {
            name: Messages.CHECKOUT_VISA_REQUIREMENTS_LINK,
        });
    }

    // ==================== Locators — insurance / add-on tiers ====================

    private insuranceAcceptNameRegex(tier: JustflyInsuranceTier): RegExp {
        if (tier === 'cancellation') {
            return /^Yes, I want cancellation protection/;
        }
        if (tier === 'travel') {
            return /^Yes, I want to add travel insurance/;
        }
        return /^Yes, I want to protect my baggage/;
    }

    private insuranceTierHeading(tier: JustflyInsuranceTier): Locator {
        const text =
            tier === 'cancellation'
                ? Messages.CHECKOUT_INSURANCE_TIER_CANCELLATION
                : tier === 'travel'
                  ? Messages.CHECKOUT_INSURANCE_TIER_TRAVEL
                  : Messages.CHECKOUT_INSURANCE_TIER_BAGGAGE;
        return this.page.getByText(text, { exact: true });
    }

    insuranceAcceptRadio(tier: JustflyInsuranceTier): Locator {
        return this.page
            .getByRole('radio', { name: this.insuranceAcceptNameRegex(tier) })
            .first(); // eslint-disable-line playwright/no-nth-methods -- duplicate radio (label wrapper + native input); first() is the wrapper.
    }

    insuranceDeclineRadio(tier: JustflyInsuranceTier): Locator {
        const declineText =
            tier === 'cancellation'
                ? Messages.CHECKOUT_INSURANCE_DECLINE_CANCELLATION
                : tier === 'travel'
                  ? Messages.CHECKOUT_INSURANCE_DECLINE_TRAVEL
                  : Messages.CHECKOUT_INSURANCE_DECLINE_BAGGAGE;
        return this.page.getByRole('radio', { name: declineText }).first(); // eslint-disable-line playwright/no-nth-methods -- duplicate radio (label wrapper + native input); first() is the wrapper.
    }

    insuranceTermsLink(tier: JustflyInsuranceTier): Locator {
        const linkName =
            tier === 'cancellation'
                ? 'View complete terms and eligibility'
                : tier === 'travel'
                  ? 'Overview'
                  : 'See complete coverage details';
        return this.page.getByRole('link', { name: linkName });
    }

    /**
     * @param tier - Insurance tier (`cancellation` / `travel` / `baggage`).
     * @returns `true` when the storefront renders this tier on the
     *          current package. JustFly does not always surface every
     *          tier — observed on staging2 2026-05-09 that the
     *          `Comprehensive Travel Insurance` tier is absent on the
     *          canonical YUL <-> LHR international itinerary even
     *          though Flighthub's equivalent renders all three.
     *          Tracked as a follow-up — see Trello card pbwz1HGE
     *          closing comment.
     */
    async tierAvailable(tier: JustflyInsuranceTier): Promise<boolean> {
        return (await this.insuranceDeclineRadio(tier).count()) > 0;
    }

    /**
     * Waits for the add-ons / insurance section to mount before any tier
     * is scanned. The checkout shell renders the URL immediately but the
     * Add-ons block hydrates after the GDS bundle response — without
     * this guard a fast-path test sees zero rendered tiers and reports
     * a false-negative (mirrors Flighthub's known mount-race).
     * Cancellation Protection is the canonical tier (always present
     * across both brands), so wait on its decline radio.
     * @returns void once the cancellation tier has mounted.
     */
    async waitForInsuranceSection(): Promise<void> {
        await expect(this.insuranceDeclineRadio('cancellation')).toBeAttached({
            timeout: Timeouts.LIVE_GDS_NAV_MS,
        });
    }

    // ==================== Locators — payment & billing ====================

    get paymentMethodHeading(): Locator {
        return this.page.getByText(Messages.CHECKOUT_PAYMENT_METHOD_HEADING, {
            exact: true,
        });
    }

    paymentMethodTab(method: 'card' | 'affirm' | 'paypal'): Locator {
        const text =
            method === 'card'
                ? Messages.CHECKOUT_PAYMENT_METHOD_CARD
                : method === 'affirm'
                  ? Messages.CHECKOUT_PAYMENT_METHOD_AFFIRM
                  : Messages.CHECKOUT_PAYMENT_METHOD_PAYPAL;
        return this.page.getByText(text, { exact: true });
    }

    get cardholderNameInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- id is the only stable hook on this PCI iframe-ish input.
        return this.page.locator('#cc_name');
    }

    get cardNumberInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- see cardholderNameInput.
        return this.page.locator('#cc_number');
    }

    get cardExpiryInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- see cardholderNameInput.
        return this.page.locator('#cc_expiry');
    }

    get cardCvvInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- see cardholderNameInput.
        return this.page.locator('#cc_cvv');
    }

    get billingAddressInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- collides with autocomplete dropdown's accessible name.
        return this.page.locator('#cc_billing_address_line1');
    }

    get billingAddressLine2Input(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- id is stable.
        return this.page.locator('#cc_billing_address_line2');
    }

    get billingCityInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- id is stable.
        return this.page.locator('#cc_city');
    }

    get billingRegionSelect(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- id is stable.
        return this.page.locator('#cc_region_code');
    }

    get billingPostalCodeInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- id is stable.
        return this.page.locator('#cc_zip');
    }

    get billingPhoneInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- collides with passenger #mobile_phone; id is stable.
        return this.page.locator('#billing_phone');
    }

    // ==================== Locators — billing-address autocomplete ====================

    get billingAddressSuggestionsList(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators, playwright/no-nth-methods -- Google Places exposes no semantic role / label; last() pins the most recently rendered container when the API mounts more than one.
        return this.page.locator('.pac-container').last();
    }

    billingAddressSuggestion(idx: number): Locator {
        // eslint-disable-next-line playwright/no-raw-locators, playwright/no-nth-methods -- Google Places suggestions have no stable text; index is the only addressable hook.
        return this.billingAddressSuggestionsList.locator('.pac-item').nth(idx);
    }

    // ==================== Locators — staging debug controls ====================

    get bookingFailureReasonHeading(): Locator {
        return this.page.getByText(
            Messages.CHECKOUT_DEBUG_BOOKING_FAILURE_REASON,
            {
                exact: true,
            }
        );
    }

    get bookingFailureReasonSelect(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- staging-only debug control with no semantic role/label.
        return this.page.locator('select').filter({ hasText: 'Fare Increase' });
    }

    get bookingFailureDelaySelect(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- staging-only debug control with no semantic role/label.
        return this.page
            .locator('select')
            .filter({ hasText: 'Max (4 Minutes)' });
    }

    get disableOptimizerSelect(): Locator {
        /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods -- staging-only debug row has no semantic role; the deepest matching div is the input wrapper, and the child <select> has no role/label. */
        return this.page
            .locator('div')
            .filter({ hasText: Messages.CHECKOUT_DEBUG_DISABLE_OPTIMIZER })
            .last()
            .locator('select');
        /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */
    }

    get defaultMerchantSelect(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- staging-only debug control with no semantic role/label.
        return this.page.locator('select').filter({ hasText: 'ConnexPay' });
    }

    // ==================== Locators — cart summary / itinerary recap ====================

    get backToSearchButton(): Locator {
        return this.page.getByRole('button', {
            name: Messages.SEARCH_RESULTS_BACK_TO_SEARCH,
        });
    }

    get priceSummaryHeading(): Locator {
        return this.page.getByText(Messages.CHECKOUT_PRICE_SUMMARY_HEADING, {
            exact: true,
        });
    }

    private get priceSummaryContainer(): Locator {
        /* eslint-disable playwright/no-raw-locators -- styled-component wrapper has no semantic role. */
        return this.priceSummaryHeading
            .locator('..')
            .locator('..')
            .locator('..');
        /* eslint-enable playwright/no-raw-locators */
    }

    priceSummaryRow(label: string): Locator {
        return this.priceSummaryContainer
            .getByText(label, { exact: true })
            .first(); // eslint-disable-line playwright/no-nth-methods -- some labels (Adults / Child / Infant in Seat) appear twice inside the container (subtotal + tax breakdown); first() pins the subtotal row.
    }

    get priceSummaryTotal(): Locator {
        return this.priceSummaryRow(Messages.CHECKOUT_PRICE_ROW_TOTAL);
    }

    get promoCodeToggle(): Locator {
        return this.page.getByText(Messages.CHECKOUT_PROMO_CODE_TOGGLE, {
            exact: true,
        });
    }

    get promoCodeInput(): Locator {
        return this.page.getByPlaceholder(
            Messages.CHECKOUT_PROMO_CODE_PLACEHOLDER
        );
    }

    get promoCodeApplyButton(): Locator {
        // JustFly text-transforms the Apply control to APPLY in the
        // promo block (Flighthub renders it as "Apply"). Match
        // case-insensitively so the locator works on both brands without
        // forking the enum value.
        return this.page
            .getByText(
                new RegExp(`^${Messages.CHECKOUT_PROMO_CODE_APPLY}$`, 'i')
            )
            .first(); // eslint-disable-line playwright/no-nth-methods -- one Apply control per promo block; first() is deterministic.
    }

    get tripSummaryHeading(): Locator {
        return this.page.getByText(Messages.CHECKOUT_TRIP_SUMMARY_HEADING, {
            exact: true,
        });
    }

    tripSummarySliceAnchor(sliceIdx: number): Locator {
        return this.page
            .getByRole('button', {
                name: Messages.CHECKOUT_BAGGAGE_INFO_BUTTON,
            })
            .nth(sliceIdx); // eslint-disable-line playwright/no-nth-methods -- one Baggage information button per slice; index pins to leg.
    }

    // ==================== Locators — fare-rules / booking terms ====================

    get bookingTermsHeading(): Locator {
        return this.page.getByRole('heading', {
            name: Messages.CHECKOUT_BOOKING_TERMS_HEADING,
            level: 3,
        });
    }

    get fareRulesLink(): Locator {
        return this.page.getByRole('button', {
            name: Messages.CHECKOUT_FARE_RULES_BUTTON,
            exact: true,
        });
    }

    get baggageFeesLink(): Locator {
        return this.page.getByRole('button', {
            name: Messages.CHECKOUT_BAGGAGE_FEES_BUTTON,
            exact: true,
        });
    }

    get feesLink(): Locator {
        return this.page.getByRole('button', {
            name: Messages.CHECKOUT_FEES_BUTTON,
            exact: true,
        });
    }

    fareRuleItem(ruleText: string): Locator {
        return this.page.getByText(ruleText, { exact: true });
    }

    // ==================== Locators — submit ====================

    get continueToPaymentButton(): Locator {
        return this.page.getByRole('button', { name: 'Continue to payment' });
    }

    get confirmAndBookButton(): Locator {
        return this.page.getByRole('button', { name: 'Confirm and Book' });
    }

    // ==================== Feedback Locators ====================

    get passengerNameHint(): Locator {
        return this.page.getByText(Messages.CHECKOUT_PASSENGER_NAME_HINT);
    }

    get processingNotice(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- modal-id scope to disambiguate duplicate notice text.
        return this.page
            .locator('#progress_modal')
            .getByText(Messages.CHECKOUT_PROCESSING_NOTICE, {
                exact: true,
            });
    }

    get passenger1FirstNameError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_FIRST_NAME_REQUIRED, {
            exact: true,
        });
    }

    get passenger1SurnameError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_LAST_NAME_REQUIRED, {
            exact: true,
        });
    }

    get passenger1DateOfBirthError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_DATE_OF_BIRTH_REQUIRED, {
            exact: true,
        });
    }

    get passenger1GenderError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_GENDER_REQUIRED, {
            exact: true,
        });
    }

    get passenger1PhoneError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_PHONE_REQUIRED, {
            exact: true,
        });
    }

    get emailRequiredError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_EMAIL_REQUIRED, {
            exact: true,
        });
    }

    get emailInvalidError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_EMAIL_INVALID, {
            exact: true,
        });
    }

    get infantAgeError(): Locator {
        return this.page.getByText(Messages.CHECKOUT_INFANT_AGE_ERROR, {
            exact: true,
        });
    }

    get expiredLinkMessage(): Locator {
        return this.page.getByText(Messages.BOOKING_LINK_EXPIRED, {
            exact: true,
        });
    }

    get fallbackSearchSubmit(): Locator {
        return this.page.getByRole('button', { name: 'SEARCH' });
    }

    // ==================== Actions ====================

    /**
     * Navigates directly to the real checkout route. Tests normally reach
     * this URL through `searchResults.selectFirstResult()`; `goto` is
     * exposed for setup / debugging.
     *
     * @param searchId - Flight-search session id.
     * @param packageId - Selected package hash.
     * @returns Promise that resolves once the document has loaded.
     */
    async goto(searchId: string, packageId: string): Promise<void> {
        await this.page.goto(
            `${Routes.FLIGHT_CHECKOUT}/${searchId}/${packageId}`
        );
    }

    /**
     * Navigates to the legacy / catch-all fallback route, which renders
     * "link expired" for any sub-path. Used by negative tests.
     *
     * @param searchId - Any path segment (route ignores it).
     * @param packageId - Any path segment (route ignores it).
     * @returns Promise that resolves once the document has loaded.
     */
    async gotoFallback(searchId: string, packageId: string): Promise<void> {
        await this.page.goto(
            `${Routes.FLIGHT_CHECKOUT_FALLBACK}/${searchId}/${packageId}`
        );
    }

    /**
     * Fills the Nth passenger row with a generated `JustflyPassenger`.
     * Storefront uses lowercase gender codes (`m` / `f`) and `MM/DD/YYYY`
     * dates regardless of the locale shown in the placeholder. Phone is
     * filled only for Passenger 1 — for higher indices the storefront
     * elides the field and the locator returns 0 elements.
     *
     * @param idx - 1-indexed passenger row.
     * @param passenger - Generated passenger payload.
     */
    async fillPassenger(
        idx: number,
        passenger: JustflyPassenger
    ): Promise<void> {
        const pax = this.passenger(idx);
        await pax.firstNameInput.fill(passenger.firstName);
        await pax.surnameInput.fill(passenger.lastName);
        const [yyyy, mm, dd] = passenger.dateOfBirth.split('-');
        await pax.dateOfBirthInput.fill(`${mm}/${dd}/${yyyy}`);
        const genderCode =
            passenger.title === 'Mrs' || passenger.title === 'Ms' ? 'f' : 'm';
        await pax.genderSelect.selectOption(genderCode);
        if (idx === 1) {
            await pax.phoneInput.fill(passenger.phone);
            await this.emailInput.fill(passenger.email);
        }
    }

    /**
     * Compatibility shim — fills Passenger 1 + ticket-delivery email.
     * Equivalent to `fillPassenger(1, passenger)`.
     *
     * @param passenger - Generated passenger payload.
     */
    async fillPassengerOne(passenger: JustflyPassenger): Promise<void> {
        await this.fillPassenger(1, passenger);
    }

    /**
     * Fills the per-pax passport block when the storefront renders it.
     * Resolves with no work done on routes where the block is elided —
     * call `passportBlockVisible(idx)` first to guard.
     *
     * @param idx - 1-indexed passenger row.
     * @param passport - Generated passport payload.
     */
    async fillPassport(idx: number, passport: JustflyPassport): Promise<void> {
        const pax = this.passenger(idx);
        if ((await pax.passportNumberInput.count()) === 0) {
            return;
        }
        await pax.nationalitySelect.selectOption(passport.nationality);
        await pax.passportNumberInput.fill(passport.passportNumber);
        const [yyyy, mm, dd] = passport.passportExpiry.split('-');
        await pax.passportExpiryInput.fill(`${mm}/${dd}/${yyyy}`);
        await pax.passportIssuingCountrySelect.selectOption(
            passport.passportIssuingCountry
        );
    }

    /**
     * @param idx - 1-indexed passenger row.
     * @returns `true` when the per-pax passport block renders for this
     *          passenger.
     */
    async passportBlockVisible(idx: number): Promise<boolean> {
        return (await this.passenger(idx).passportNumberInput.count()) > 0;
    }

    /**
     * Selects an insurance / add-on tier choice (accept or decline).
     *
     * @param tier - Insurance tier (`cancellation` / `travel` / `baggage`).
     * @param choice - `accept` to opt in, `decline` to opt out.
     */
    async selectInsurance(
        tier: JustflyInsuranceTier,
        choice: JustflyInsuranceChoice
    ): Promise<void> {
        const radio =
            choice === 'accept'
                ? this.insuranceAcceptRadio(tier)
                : this.insuranceDeclineRadio(tier);
        await radio.scrollIntoViewIfNeeded();
        await radio.click();
    }

    /**
     * Fills the payment + billing form with a generated `JustflyPayment`.
     * Country / Region default to Canada / Quebec from the GeoIP pre-fill
     * and are not touched.
     *
     * @param payment - Generated payment payload.
     */
    async fillPaymentAndBilling(payment: JustflyPayment): Promise<void> {
        await this.cardholderNameInput.fill(payment.cardholderName);
        await this.cardNumberInput.fill(payment.cardNumber);
        await this.cardExpiryInput.fill(
            `${payment.expiryMonth} / ${payment.expiryYear.slice(-2)}`
        );
        await this.cardCvvInput.fill(payment.cvv);
        await this.billingAddressInput.fill(payment.billingAddressLine1);
        await this.billingCityInput.fill(payment.billingCity);
        await this.billingPostalCodeInput.fill(payment.billingPostalCode);
        await this.billingPhoneInput.fill(payment.billingPhone);
    }

    /**
     * Types into the billing-address field and clicks the matching
     * Google Places suggestion.
     *
     * @param query - Free-text address query (street + city / region).
     * @param matchText - Substring of the suggestion to click.
     */
    async selectBillingAddressSuggestion(
        query: string,
        matchText: string
    ): Promise<void> {
        await this.billingAddressInput.click();
        await this.billingAddressInput.pressSequentially(query, {
            delay: 60,
        });
        const suggestion = this.billingAddressSuggestionsList.getByText(
            matchText,
            { exact: false }
        );
        // eslint-disable-next-line playwright/no-nth-methods -- first matching suggestion is the canonical hit; Places returns ranked results.
        await suggestion.first().click();
    }

    /**
     * Expands the Promo Code section (collapsed by default) and applies
     * the supplied code.
     *
     * @param code - Promo code to apply.
     */
    async applyPromoCode(code: string): Promise<void> {
        if (!(await this.promoCodeInput.isVisible())) {
            await this.promoCodeToggle.click();
        }
        await this.promoCodeInput.fill(code);
        await this.promoCodeApplyButton.click();
    }

    /**
     * Toggles the staging-only optimizer / repricer kill-switch.
     *
     * @param disabled - `true` selects "Yes" (disable), `false` selects
     *                   "No" (default; optimizer active).
     */
    async setOptimizerDisabled(disabled: boolean): Promise<void> {
        await this.disableOptimizerSelect.selectOption(disabled ? 'Yes' : 'No');
    }

    /**
     * Clicks "Continue to payment" and waits for the payment / billing
     * surface to expand. The reliable post-click signal is the storefront
     * unmounting `_tripInfoContinueButton_*` once the payment step
     * expands; once the button is gone, `cardholderNameInput` is the
     * first user-facing payment input in tab order.
     *
     * @returns Promise that resolves once the cardholder-name input is visible.
     */
    async continueToPayment(): Promise<void> {
        await this.continueToPaymentButton.click();
        await expect(this.continueToPaymentButton).toBeHidden({
            timeout: Timeouts.PAYMENT_SECTION_EXPAND_MS,
        });
        await expect(this.cardholderNameInput).toBeVisible();
    }

    /**
     * Pins the staging "Default Merchant" debug combobox to ConnexPay so
     * the booking is routed through ConnexPay's own anti-fraud rules
     * instead of the storefront's front-line Fraud Prevention API, which
     * blocks repeat charges from the same Stripe test BIN within minutes.
     */
    async useConnexPayMerchant(): Promise<void> {
        await this.defaultMerchantSelect.selectOption('ConnexPay');
    }

    /**
     * Clicks "Confirm and Book" and waits for the storefront to redirect
     * to the post-booking trip-detail page (`Routes.PORTAL_DETAIL/{token}`).
     *
     * @param timeoutMs - Upper bound for the post-payment redirect;
     *                    defaults to `Timeouts.BOOKING_CONFIRMATION_MS`.
     */
    async submitBookingAndAwaitConfirmation(
        timeoutMs: number = Timeouts.BOOKING_CONFIRMATION_MS
    ): Promise<void> {
        await this.confirmAndBookButton.click();
        await this.page.waitForURL(
            new RegExp(`${Routes.PORTAL_DETAIL}/[a-f0-9]+`),
            { timeout: timeoutMs, waitUntil: 'commit' }
        );
    }

    validationErrorFor(field: EmptyFormValidationField): Locator {
        switch (field) {
            case 'firstName':
                return this.passenger1FirstNameError;
            case 'surname':
                return this.passenger1SurnameError;
            case 'dateOfBirth':
                return this.passenger1DateOfBirthError;
            case 'gender':
                return this.passenger1GenderError;
            case 'phone':
                return this.passenger1PhoneError;
            case 'email':
                return this.emailRequiredError;
        }
    }
}
