import { expect, test } from '../../../fixtures/pom/test-options';
import { Routes } from '../../../enums/justfly/justfly';
import { Timeouts } from '../../../enums/util/timeouts';
import { generateOneWaySearch } from '../../../test-data/factories/justfly/search.factory';
import {
    EMPTY_FORM_VALIDATION_CASES,
    INVALID_EMAIL_PROBE,
} from '../../../test-data/static/justfly/invalidCheckoutInputs';

const CHECKOUT_URL_PATTERN = new RegExp(
    `${Routes.FLIGHT_CHECKOUT.replace(/\//g, '\\/')}\\/[a-f0-9]+\\/[a-f0-9]+`
);

test.describe('justfly checkout page', () => {
    test(
        'invalid search/package IDs render the expired-link fallback',
        { tag: '@regression' },
        async ({ justflyCheckoutPage }) => {
            await test.step('GIVEN the user navigates to the legacy fallback checkout URL with invalid IDs', async () => {
                await justflyCheckoutPage.gotoFallback(
                    'invalid-search-id',
                    'invalid-package-id'
                );
            });

            await test.step('THEN the expired-link message is displayed', async () => {
                await expect(
                    justflyCheckoutPage.expiredLinkMessage
                ).toBeVisible();
            });

            await test.step('AND the fallback page exposes a recoverable SEARCH button', async () => {
                await expect(
                    justflyCheckoutPage.fallbackSearchSubmit
                ).toBeVisible();
            });
        }
    );

    test.describe('reached via the live search → select flow', () => {
        // Live GDS search + modal sequence routinely takes 30-60s; raise
        // the per-test timeout above the 60s global default.
        test.describe.configure({ timeout: Timeouts.CHECKOUT_FLOW_MS });

        test.beforeEach(
            async ({ justflyHomePage, justflySearchResultsPage, page }) => {
                const search = generateOneWaySearch({
                    origin: 'YUL',
                    destination: 'JFK',
                    adults: 1,
                });
                await justflyHomePage.submitOneWaySearch(search);
                await justflySearchResultsPage.selectFirstResult();
                await expect(page).toHaveURL(CHECKOUT_URL_PATTERN, {
                    timeout: Timeouts.LIVE_GDS_NAV_MS,
                });
            }
        );

        test(
            'renders the passenger details + ticket-delivery form sections',
            { tag: '@regression' },
            async ({ justflyCheckoutPage }) => {
                await test.step('THEN the Passenger 1 details section renders the required fields', async () => {
                    await expect(
                        justflyCheckoutPage.passenger1Heading
                    ).toBeVisible();
                    await expect(
                        justflyCheckoutPage.passenger1FirstNameInput
                    ).toBeVisible();
                    await expect(
                        justflyCheckoutPage.passenger1SurnameInput
                    ).toBeVisible();
                    await expect(
                        justflyCheckoutPage.passenger1DateOfBirthInput
                    ).toBeVisible();
                    await expect(
                        justflyCheckoutPage.passenger1GenderSelect
                    ).toBeVisible();
                    await expect(
                        justflyCheckoutPage.passenger1PhoneInput
                    ).toBeVisible();
                });

                await test.step('AND the passenger-name passport hint is shown', async () => {
                    await expect(
                        justflyCheckoutPage.passengerNameHint
                    ).toBeVisible();
                });

                await test.step('AND the ticket-delivery section asks for an email', async () => {
                    await expect(
                        justflyCheckoutPage.ticketDeliveryHeading
                    ).toBeVisible();
                    await expect(justflyCheckoutPage.emailInput).toBeVisible();
                });

                await test.step('AND the "Continue to payment" submit is rendered', async () => {
                    await expect(
                        justflyCheckoutPage.continueToPaymentButton
                    ).toBeVisible();
                });
            }
        );

        test(
            'shows per-field validation when passenger details are empty',
            { tag: '@regression' },
            async ({ justflyCheckoutPage }) => {
                await test.step('WHEN "Continue to payment" is pressed with every field blank', async () => {
                    await justflyCheckoutPage.continueToPaymentButton.click();
                });

                for (const {
                    field,
                    description,
                } of EMPTY_FORM_VALIDATION_CASES) {
                    await test.step(`THEN the inline error is shown when ${description}`, async () => {
                        await expect(
                            justflyCheckoutPage.validationErrorFor(field)
                        ).toBeVisible();
                    });
                }
            }
        );

        test(
            'shows the invalid-email error when a malformed email is submitted',
            { tag: '@regression' },
            async ({ justflyCheckoutPage }) => {
                await test.step('GIVEN a malformed email is typed into the ticket-delivery field', async () => {
                    await justflyCheckoutPage.emailInput.fill(
                        INVALID_EMAIL_PROBE
                    );
                });

                await test.step('WHEN "Continue to payment" is pressed', async () => {
                    await justflyCheckoutPage.continueToPaymentButton.click();
                });

                await test.step('THEN the "Invalid email address" error replaces the "required" error', async () => {
                    await expect(
                        justflyCheckoutPage.emailInvalidError
                    ).toBeVisible();
                    await expect(
                        justflyCheckoutPage.emailRequiredError
                    ).toHaveCount(0);
                });
            }
        );
    });
});
