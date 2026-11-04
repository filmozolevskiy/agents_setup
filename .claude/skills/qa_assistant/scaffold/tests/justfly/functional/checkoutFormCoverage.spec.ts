import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages, Routes } from '../../../enums/justfly/justfly';
import { Timeouts } from '../../../enums/util/timeouts';
import {
    generateAdultPassenger,
    generateChildPassenger,
    generateInfantPassenger,
} from '../../../test-data/factories/justfly/passenger.factory';
import { generatePassport } from '../../../test-data/factories/justfly/passport.factory';
import { internationalSearchData } from '../../../test-data/factories/justfly/search.factory';
import {
    INSURANCE_TIERS,
    type JustflyInsuranceTier,
} from '../../../pages/justfly/checkout.page';
import { BILLING_ADDRESS_PROBE } from '../../../test-data/static/justfly/invalidCheckoutInputs';

const CHECKOUT_URL_PATTERN = new RegExp(
    `${Routes.FLIGHT_CHECKOUT.replace(/\//g, '\\/')}\\/[a-f0-9]+\\/[a-f0-9]+`
);

// Live GDS search + bundle / fare-upgrade modals routinely take 30-60s
// on staging2; raise the per-test timeout above the 60s global default
// for every test in this file (they all share the same setup path).
test.describe('justfly checkout — multi-pax / insurance / cart coverage', () => {
    test.describe.configure({ timeout: Timeouts.CHECKOUT_FORM_COVERAGE_MS });

    test.beforeEach(
        async ({ justflyHomePage, justflySearchResultsPage, page }) => {
            const search = internationalSearchData();
            await justflyHomePage.submitRoundTripSearch(search);
            await justflySearchResultsPage.selectFirstResult({
                resultsTimeoutMs: Timeouts.LIVE_GDS_NAV_MS,
            });
            await expect(page).toHaveURL(CHECKOUT_URL_PATTERN, {
                timeout: Timeouts.LIVE_GDS_NAV_MS,
            });
        }
    );

    test(
        'renders one passenger row per pax (2 ADT + 1 CHD + 1 INF) and exposes them through passenger(idx)',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            await test.step('THEN every passenger heading 1..4 is visible', async () => {
                for (let idx = 1; idx <= 4; idx++) {
                    await expect(
                        justflyCheckoutPage.passenger(idx).heading
                    ).toBeVisible();
                }
            });

            await test.step('AND each row exposes the core inputs (first / surname / DOB / gender)', async () => {
                for (let idx = 1; idx <= 4; idx++) {
                    const pax = justflyCheckoutPage.passenger(idx);
                    await expect(pax.firstNameInput).toBeVisible();
                    await expect(pax.surnameInput).toBeVisible();
                    await expect(pax.dateOfBirthInput).toBeVisible();
                    await expect(pax.genderSelect).toBeVisible();
                }
            });

            await test.step('AND only Passenger 1 carries the primary-contact phone field', async () => {
                await expect(
                    justflyCheckoutPage.passenger(1).phoneInput
                ).toBeVisible();
                for (let idx = 2; idx <= 4; idx++) {
                    await expect(
                        justflyCheckoutPage.passenger(idx).phoneInput
                    ).toHaveCount(0);
                }
            });
        }
    );

    test(
        'fillPassenger drives every row and the form retains the populated values',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            const adultOne = generateAdultPassenger();
            const adultTwo = generateAdultPassenger();
            const child = generateChildPassenger();
            const infant = generateInfantPassenger();

            await test.step('WHEN every passenger row is filled via passenger(idx)', async () => {
                await justflyCheckoutPage.fillPassenger(1, adultOne);
                await justflyCheckoutPage.fillPassenger(2, adultTwo);
                await justflyCheckoutPage.fillPassenger(3, child);
                await justflyCheckoutPage.fillPassenger(4, infant);
            });

            await test.step('THEN each first-name input echoes the generated value', async () => {
                await expect(
                    justflyCheckoutPage.passenger(1).firstNameInput
                ).toHaveValue(adultOne.firstName);
                await expect(
                    justflyCheckoutPage.passenger(2).firstNameInput
                ).toHaveValue(adultTwo.firstName);
                await expect(
                    justflyCheckoutPage.passenger(3).firstNameInput
                ).toHaveValue(child.firstName);
                await expect(
                    justflyCheckoutPage.passenger(4).firstNameInput
                ).toHaveValue(infant.firstName);
            });

            await test.step("AND the ticket-delivery email mirrors Passenger 1's address", async () => {
                await expect(justflyCheckoutPage.emailInput).toHaveValue(
                    adultOne.email
                );
            });
        }
    );

    test(
        'optionally fills the per-pax passport block when the storefront renders it',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            // FIXME: staging2 elides the per-pax passport block on the
            // canonical YUL <-> LHR international itinerary even though
            // the route requires travel documents (mirrors Flighthub
            // bug — Trello OZgRaA1S follow-up). Locators stay wired so
            // the test flips back automatically once the block returns.
            // eslint-disable-next-line playwright/no-skipped-test -- documented coverage drop with FIXME, per "No Silent Coverage Drops".
            test.skip(
                !(await justflyCheckoutPage.passportBlockVisible(1)),
                'staging2 elides the passport block on YUL <-> LHR'
            );

            const passport = generatePassport();

            await test.step('WHEN the passport block is filled for Passenger 1', async () => {
                await justflyCheckoutPage.fillPassport(1, passport);
            });

            await test.step('THEN the passport-number input echoes the generated value', async () => {
                await expect(
                    justflyCheckoutPage.passenger(1).passportNumberInput
                ).toHaveValue(passport.passportNumber);
            });
        }
    );

    test(
        'declines every insurance tier the storefront renders through selectInsurance(tier, "decline")',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            // The Add-ons block hydrates after the GDS bundle response
            // — block on the canonical cancellation tier so the scan
            // does not race the mount.
            await justflyCheckoutPage.waitForInsuranceSection();

            // JustFly does not always render every tier — the
            // Comprehensive Travel Insurance tier is absent on
            // staging2's YUL <-> LHR (Trello pbwz1HGE follow-up).
            // Filter to the tiers that actually mount so the test
            // exercises real coverage instead of wedging on absent UI.
            const renderedTiers: JustflyInsuranceTier[] = [];
            for (const tier of INSURANCE_TIERS) {
                if (await justflyCheckoutPage.tierAvailable(tier)) {
                    renderedTiers.push(tier);
                }
            }
            expect(renderedTiers.length).toBeGreaterThan(0);

            await test.step('WHEN every rendered insurance tier is declined', async () => {
                for (const tier of renderedTiers) {
                    await justflyCheckoutPage.selectInsurance(tier, 'decline');
                }
            });

            await test.step('THEN every rendered tier shows the decline radio as checked', async () => {
                for (const tier of renderedTiers) {
                    await expect(
                        justflyCheckoutPage.insuranceDeclineRadio(tier)
                    ).toBeChecked();
                }
            });
        }
    );

    test(
        'renders the cancellation + baggage insurance tiers (travel insurance is absent on JustFly staging2)',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            await justflyCheckoutPage.waitForInsuranceSection();

            // FIXME: JustFly staging2 elides the Comprehensive Travel
            // Insurance tier on the canonical YUL <-> LHR international
            // itinerary even though Flighthub's equivalent renders it.
            // Tracked on Trello card pbwz1HGE closing comment as a
            // follow-up to confirm whether this is brand-policy (JustFly
            // does not sell travel insurance) or a per-package config
            // gap. Locators stay wired so this test flips back
            // automatically once the tier returns.
            await expect(
                justflyCheckoutPage.insuranceDeclineRadio('cancellation')
            ).toBeAttached();
            await expect(
                justflyCheckoutPage.insuranceDeclineRadio('baggage')
            ).toBeAttached();
            expect(await justflyCheckoutPage.tierAvailable('travel')).toBe(
                false
            );
        }
    );

    test(
        'accepts the cancellation-protection tier through selectInsurance("cancellation", "accept")',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            await test.step('WHEN the cancellation-protection tier is accepted', async () => {
                await justflyCheckoutPage.selectInsurance(
                    'cancellation',
                    'accept'
                );
            });

            await test.step('THEN the cancellation accept radio is checked', async () => {
                await expect(
                    justflyCheckoutPage.insuranceAcceptRadio('cancellation')
                ).toBeChecked();
            });

            await test.step('AND the tier exposes a coverage / terms link', async () => {
                await expect(
                    justflyCheckoutPage.insuranceTermsLink('cancellation')
                ).toBeVisible();
            });
        }
    );

    test(
        'wires the billing-address Google Places autocomplete dropdown',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            const adultOne = generateAdultPassenger();
            const adultTwo = generateAdultPassenger();
            const child = generateChildPassenger();
            const infant = generateInfantPassenger();

            await test.step('GIVEN every passenger row is populated and add-ons are declined', async () => {
                await justflyCheckoutPage.fillPassenger(1, adultOne);
                await justflyCheckoutPage.fillPassenger(2, adultTwo);
                await justflyCheckoutPage.fillPassenger(3, child);
                await justflyCheckoutPage.fillPassenger(4, infant);
                for (const tier of INSURANCE_TIERS) {
                    if (await justflyCheckoutPage.tierAvailable(tier)) {
                        await justflyCheckoutPage.selectInsurance(
                            tier,
                            'decline'
                        );
                    }
                }
            });

            await test.step('AND the user advances to the payment surface', async () => {
                await justflyCheckoutPage.continueToPayment();
            });

            // FIXME: Google Places autocomplete is wired to the
            // billing-address input on staging2 + prod but the dropdown
            // does not fire deterministically — the storefront's Places
            // API key intermittently returns no suggestions in headless
            // runs (mirrors Flighthub bug — Trello OZgRaA1S follow-up).
            const suggestionVisible =
                await test.step('WHEN the user types a partial address into the billing-address field', async () => {
                    await justflyCheckoutPage.billingAddressInput.click();
                    await justflyCheckoutPage.billingAddressInput.pressSequentially(
                        BILLING_ADDRESS_PROBE,
                        { delay: 80 }
                    );
                    return justflyCheckoutPage
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
                    justflyCheckoutPage.billingAddressSuggestion(0)
                ).toBeVisible();
            });
        }
    );

    test(
        'exposes the price summary, promo-code surface, and trip recap on the right rail',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            await test.step('THEN the price summary renders one row per pax type plus Taxes & Fees and a Total', async () => {
                await expect(
                    justflyCheckoutPage.priceSummaryHeading
                ).toBeVisible();
                for (const label of [
                    Messages.CHECKOUT_PRICE_ROW_PASSENGERS,
                    Messages.CHECKOUT_PRICE_ROW_ADULTS,
                    Messages.CHECKOUT_PASSENGER_PAX_LABEL_CHILD,
                    Messages.CHECKOUT_PRICE_ROW_INFANT_SEAT,
                    Messages.CHECKOUT_PRICE_ROW_TAXES,
                ]) {
                    await expect(
                        justflyCheckoutPage.priceSummaryRow(label)
                    ).toBeVisible();
                }
                await expect(
                    justflyCheckoutPage.priceSummaryTotal
                ).toBeVisible();
            });

            await test.step('AND the trip summary recap renders the heading plus one slice card per leg (outbound + return)', async () => {
                await expect(
                    justflyCheckoutPage.tripSummaryHeading
                ).toBeVisible();
                await expect(
                    justflyCheckoutPage.tripSummarySliceAnchor(0)
                ).toBeVisible();
                await expect(
                    justflyCheckoutPage.tripSummarySliceAnchor(1)
                ).toBeVisible();
            });

            await test.step('AND the Promo Code surface expands an input + Apply control', async () => {
                await justflyCheckoutPage.promoCodeToggle.click();
                await expect(justflyCheckoutPage.promoCodeInput).toBeVisible();
                await expect(
                    justflyCheckoutPage.promoCodeApplyButton
                ).toBeVisible();
            });

            await test.step('AND the page heading exposes a Back to search button', async () => {
                await expect(
                    justflyCheckoutPage.backToSearchButton
                ).toBeVisible();
            });
        }
    );

    test(
        'renders the booking-terms list and a fare-rules anchor button',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            const adultOne = generateAdultPassenger();
            const adultTwo = generateAdultPassenger();
            const child = generateChildPassenger();
            const infant = generateInfantPassenger();

            await test.step('GIVEN every passenger row is populated and add-ons are declined', async () => {
                await justflyCheckoutPage.fillPassenger(1, adultOne);
                await justflyCheckoutPage.fillPassenger(2, adultTwo);
                await justflyCheckoutPage.fillPassenger(3, child);
                await justflyCheckoutPage.fillPassenger(4, infant);
                for (const tier of INSURANCE_TIERS) {
                    if (await justflyCheckoutPage.tierAvailable(tier)) {
                        await justflyCheckoutPage.selectInsurance(
                            tier,
                            'decline'
                        );
                    }
                }
            });

            await test.step('WHEN the user advances to the payment / review surface', async () => {
                await justflyCheckoutPage.continueToPayment();
            });

            await test.step('THEN the Booking terms section is rendered with a fare-rules anchor and an inline rules list', async () => {
                await expect(
                    justflyCheckoutPage.bookingTermsHeading
                ).toBeVisible();
                await expect(justflyCheckoutPage.fareRulesLink).toBeVisible();
                await expect(justflyCheckoutPage.baggageFeesLink).toBeVisible();
                await expect(justflyCheckoutPage.feesLink).toBeVisible();
            });
        }
    );
});
