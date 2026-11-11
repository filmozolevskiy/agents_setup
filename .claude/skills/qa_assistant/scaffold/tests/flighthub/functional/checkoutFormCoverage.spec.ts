import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages } from '../../../enums/flighthub/flighthub';
import { Timeouts } from '../../../enums/util/timeouts';
import {
    generateAdultPassenger,
    generateChildPassenger,
    generateInfantPassenger,
} from '../../../test-data/factories/flighthub/passenger.factory';
import { generatePassport } from '../../../test-data/factories/flighthub/passport.factory';
import { internationalSearchData } from '../../../test-data/factories/flighthub/search.factory';
import { INSURANCE_TIERS } from '../../../pages/flighthub/checkout.page';

// Live GDS search + bundle / fare-upgrade modals routinely take 30-60s
// on staging2; raise the per-test timeout above the 60s global default
// for every test in this file (they all share the same setup path).
test.describe('flighthub checkout — multi-pax / insurance / cart coverage', () => {
    test.describe.configure({ timeout: 240_000 });

    test.beforeEach(
        async ({ flighthubHomePage, flighthubSearchResultsPage, page }) => {
            const search = internationalSearchData();
            await flighthubHomePage.submitRoundTripSearch(search);
            await flighthubSearchResultsPage.selectFirstResult({
                resultsTimeoutMs: Timeouts.LIVE_GDS_NAV_MS,
            });
            await expect(page).toHaveURL(
                /\/checkout\/billing\/flight\/[a-f0-9]+\/[a-f0-9]+/,
                { timeout: Timeouts.LIVE_GDS_NAV_MS }
            );
        }
    );

    test(
        'renders one passenger row per pax (2 ADT + 1 CHD + 1 INF) and exposes them through passenger(idx)',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            await test.step('THEN every passenger heading 1..4 is visible', async () => {
                for (let idx = 1; idx <= 4; idx++) {
                    await expect(
                        flighthubCheckoutPage.passenger(idx).heading
                    ).toBeVisible();
                }
            });

            await test.step('AND each row exposes the core inputs (first / surname / DOB / gender)', async () => {
                for (let idx = 1; idx <= 4; idx++) {
                    const pax = flighthubCheckoutPage.passenger(idx);
                    await expect(pax.firstNameInput).toBeVisible();
                    await expect(pax.surnameInput).toBeVisible();
                    await expect(pax.dateOfBirthInput).toBeVisible();
                    await expect(pax.genderSelect).toBeVisible();
                }
            });

            await test.step('AND only Passenger 1 carries the primary-contact phone field', async () => {
                await expect(
                    flighthubCheckoutPage.passenger(1).phoneInput
                ).toBeVisible();
                for (let idx = 2; idx <= 4; idx++) {
                    await expect(
                        flighthubCheckoutPage.passenger(idx).phoneInput
                    ).toHaveCount(0);
                }
            });
        }
    );

    test(
        'fillPassenger drives every row and the form retains the populated values',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            const adultOne = generateAdultPassenger();
            const adultTwo = generateAdultPassenger();
            const child = generateChildPassenger();
            const infant = generateInfantPassenger();

            await test.step('WHEN every passenger row is filled via passenger(idx)', async () => {
                await flighthubCheckoutPage.fillPassenger(1, adultOne);
                await flighthubCheckoutPage.fillPassenger(2, adultTwo);
                await flighthubCheckoutPage.fillPassenger(3, child);
                await flighthubCheckoutPage.fillPassenger(4, infant);
            });

            await test.step('THEN each first-name input echoes the generated value', async () => {
                await expect(
                    flighthubCheckoutPage.passenger(1).firstNameInput
                ).toHaveValue(adultOne.firstName);
                await expect(
                    flighthubCheckoutPage.passenger(2).firstNameInput
                ).toHaveValue(adultTwo.firstName);
                await expect(
                    flighthubCheckoutPage.passenger(3).firstNameInput
                ).toHaveValue(child.firstName);
                await expect(
                    flighthubCheckoutPage.passenger(4).firstNameInput
                ).toHaveValue(infant.firstName);
            });

            await test.step("AND the ticket-delivery email mirrors Passenger 1's address", async () => {
                await expect(flighthubCheckoutPage.emailInput).toHaveValue(
                    adultOne.email
                );
            });
        }
    );

    test(
        'optionally fills the per-pax passport block when the storefront renders it',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            // FIXME: staging2 elides the per-pax passport block on the
            // canonical YUL <-> LHR international itinerary even though
            // the route requires travel documents. Skip the assertion
            // body until the storefront enables the block on staging2
            // (Trello OZgRaA1S follow-up). Locators stay wired so the
            // test flips back automatically once the block returns.
            // eslint-disable-next-line playwright/no-skipped-test -- documented coverage drop with FIXME, per "No Silent Coverage Drops".
            test.skip(
                !(await flighthubCheckoutPage.passportBlockVisible(1)),
                'staging2 elides the passport block on YUL <-> LHR'
            );

            const passport = generatePassport();

            await test.step('WHEN the passport block is filled for Passenger 1', async () => {
                await flighthubCheckoutPage.fillPassport(1, passport);
            });

            await test.step('THEN the passport-number input echoes the generated value', async () => {
                await expect(
                    flighthubCheckoutPage.passenger(1).passportNumberInput
                ).toHaveValue(passport.passportNumber);
            });
        }
    );

    test(
        'declines every insurance tier through selectInsurance(tier, "decline")',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            await test.step('WHEN every insurance tier is declined', async () => {
                for (const tier of INSURANCE_TIERS) {
                    await flighthubCheckoutPage.selectInsurance(
                        tier,
                        'decline'
                    );
                }
            });

            await test.step('THEN every tier shows the decline radio as checked', async () => {
                for (const tier of INSURANCE_TIERS) {
                    await expect(
                        flighthubCheckoutPage.insuranceDeclineRadio(tier)
                    ).toBeChecked();
                }
            });
        }
    );

    test(
        'accepts the cancellation-protection tier through selectInsurance("cancellation", "accept")',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            await test.step('WHEN the cancellation-protection tier is accepted', async () => {
                await flighthubCheckoutPage.selectInsurance(
                    'cancellation',
                    'accept'
                );
            });

            await test.step('THEN the cancellation accept radio is checked', async () => {
                await expect(
                    flighthubCheckoutPage.insuranceAcceptRadio('cancellation')
                ).toBeChecked();
            });

            await test.step('AND the tier exposes a coverage / terms link', async () => {
                await expect(
                    flighthubCheckoutPage.insuranceTermsLink('cancellation')
                ).toBeVisible();
            });
        }
    );

    test(
        'wires the billing-address Google Places autocomplete dropdown',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            const adultOne = generateAdultPassenger();
            const adultTwo = generateAdultPassenger();
            const child = generateChildPassenger();
            const infant = generateInfantPassenger();

            await test.step('GIVEN every passenger row is populated and add-ons are declined', async () => {
                await flighthubCheckoutPage.fillPassenger(1, adultOne);
                await flighthubCheckoutPage.fillPassenger(2, adultTwo);
                await flighthubCheckoutPage.fillPassenger(3, child);
                await flighthubCheckoutPage.fillPassenger(4, infant);
                for (const tier of INSURANCE_TIERS) {
                    await flighthubCheckoutPage.selectInsurance(
                        tier,
                        'decline'
                    );
                }
            });

            await test.step('AND the user advances to the payment surface', async () => {
                await flighthubCheckoutPage.continueToPayment();
            });

            // FIXME: Google Places autocomplete is wired to the
            // billing-address input on staging2 + prod but the dropdown
            // does not fire deterministically — the storefront's Places
            // API key intermittently returns no suggestions in headless
            // runs (Trello OZgRaA1S follow-up). The probe gates on the
            // first `.pac-item` rendering rather than `.pac-container`
            // count, because Places sometimes mounts an empty container
            // wrapper without ever filling rows.
            const suggestionVisible =
                await test.step('WHEN the user types a partial address into the billing-address field', async () => {
                    await flighthubCheckoutPage.billingAddressInput.click();
                    await flighthubCheckoutPage.billingAddressInput.pressSequentially(
                        '100 Bloor St',
                        { delay: 80 }
                    );
                    return flighthubCheckoutPage
                        .billingAddressSuggestion(0)
                        .waitFor({
                            state: 'visible',
                            timeout: Timeouts.GOOGLE_PLACES_PROBE_MS,
                        })
                        .then(() => true)
                        .catch(() => false);
                });

            // eslint-disable-next-line playwright/no-skipped-test -- documented coverage drop with FIXME, per "No Silent Coverage Drops".
            test.skip(
                !suggestionVisible,
                'Google Places dropdown did not render a suggestion row (Trello OZgRaA1S)'
            );

            await test.step('THEN the suggestions list renders at least one .pac-item row', async () => {
                await expect(
                    flighthubCheckoutPage.billingAddressSuggestion(0)
                ).toBeVisible();
            });
        }
    );

    test(
        'exposes the price summary, promo-code surface, and trip recap on the right rail',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            await test.step('THEN the price summary renders one row per pax type plus Taxes & Fees and a Total', async () => {
                await expect(
                    flighthubCheckoutPage.priceSummaryHeading
                ).toBeVisible();
                for (const label of [
                    Messages.CHECKOUT_PRICE_ROW_PASSENGERS,
                    Messages.CHECKOUT_PRICE_ROW_ADULTS,
                    Messages.CHECKOUT_PASSENGER_PAX_LABEL_CHILD,
                    Messages.CHECKOUT_PRICE_ROW_INFANT_SEAT,
                    Messages.CHECKOUT_PRICE_ROW_TAXES,
                ]) {
                    await expect(
                        flighthubCheckoutPage.priceSummaryRow(label)
                    ).toBeVisible();
                }
                await expect(
                    flighthubCheckoutPage.priceSummaryTotal
                ).toBeVisible();
            });

            await test.step('AND the trip summary recap renders the heading plus one slice card per leg (outbound + return)', async () => {
                await expect(
                    flighthubCheckoutPage.tripSummaryHeading
                ).toBeVisible();
                await expect(
                    flighthubCheckoutPage.tripSummarySliceAnchor(0)
                ).toBeVisible();
                await expect(
                    flighthubCheckoutPage.tripSummarySliceAnchor(1)
                ).toBeVisible();
            });

            await test.step('AND the Promo Code surface expands an input + Apply control', async () => {
                await flighthubCheckoutPage.promoCodeToggle.click();
                await expect(
                    flighthubCheckoutPage.promoCodeInput
                ).toBeVisible();
                await expect(
                    flighthubCheckoutPage.promoCodeApplyButton
                ).toBeVisible();
            });

            await test.step('AND the page heading exposes a Back to search button', async () => {
                await expect(
                    flighthubCheckoutPage.backToSearchButton
                ).toBeVisible();
            });
        }
    );

    test(
        'renders the booking-terms list and a fare-rules anchor button',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            const adultOne = generateAdultPassenger();
            const adultTwo = generateAdultPassenger();
            const child = generateChildPassenger();
            const infant = generateInfantPassenger();

            await test.step('GIVEN every passenger row is populated and add-ons are declined', async () => {
                await flighthubCheckoutPage.fillPassenger(1, adultOne);
                await flighthubCheckoutPage.fillPassenger(2, adultTwo);
                await flighthubCheckoutPage.fillPassenger(3, child);
                await flighthubCheckoutPage.fillPassenger(4, infant);
                for (const tier of INSURANCE_TIERS) {
                    await flighthubCheckoutPage.selectInsurance(
                        tier,
                        'decline'
                    );
                }
            });

            await test.step('WHEN the user advances to the payment / review surface', async () => {
                await flighthubCheckoutPage.continueToPayment();
            });

            await test.step('THEN the Booking terms section is rendered with a fare-rules anchor and an inline rules list', async () => {
                await expect(
                    flighthubCheckoutPage.bookingTermsHeading
                ).toBeVisible();
                await expect(flighthubCheckoutPage.fareRulesLink).toBeVisible();
                await expect(
                    flighthubCheckoutPage.baggageFeesLink
                ).toBeVisible();
                await expect(flighthubCheckoutPage.feesLink).toBeVisible();
            });
        }
    );
});
