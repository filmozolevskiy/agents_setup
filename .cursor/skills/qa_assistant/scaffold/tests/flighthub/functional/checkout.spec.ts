import { expect, test } from '../../../fixtures/pom/test-options';
import { generateOneWaySearch } from '../../../test-data/factories/flighthub/search.factory';
import { EMPTY_FORM_VALIDATION_CASES } from '../../../test-data/static/flighthub/invalidCheckoutInputs';

test.describe('flighthub checkout page', () => {
    test(
        'invalid search/package IDs render the expired-link fallback',
        { tag: '@regression' },
        async ({ flighthubCheckoutPage }) => {
            await test.step('GIVEN the user navigates to the legacy fallback checkout URL with invalid IDs', async () => {
                await flighthubCheckoutPage.gotoFallback(
                    'invalid-search-id',
                    'invalid-package-id'
                );
            });

            await test.step('THEN the expired-link message is displayed', async () => {
                await expect(
                    flighthubCheckoutPage.expiredLinkMessage
                ).toBeVisible();
            });

            await test.step('AND the fallback page exposes a recoverable SEARCH button', async () => {
                await expect(
                    flighthubCheckoutPage.fallbackSearchSubmit
                ).toBeVisible();
            });
        }
    );

    test.describe('reached via the live search → select flow', () => {
        // Live GDS search + modal sequence routinely takes 30-60s; raise
        // the per-test timeout above the 60s global default.
        test.describe.configure({ timeout: 180000 });

        test.beforeEach(
            async ({ flighthubHomePage, flighthubSearchResultsPage, page }) => {
                // adults: 1 keeps a single Passenger row — multiple rows
                // would strict-mode collide on the shared field IDs.
                const search = generateOneWaySearch({
                    origin: 'YUL',
                    destination: 'JFK',
                    adults: 1,
                });
                await flighthubHomePage.submitOneWaySearch(search);
                await flighthubSearchResultsPage.selectFirstResult();
                await expect(page).toHaveURL(
                    /\/checkout\/billing\/flight\/[a-f0-9]+\/[a-f0-9]+/,
                    { timeout: 60000 }
                );
            }
        );

        test(
            'renders the passenger details + ticket-delivery form sections',
            { tag: '@regression' },
            async ({ flighthubCheckoutPage }) => {
                await test.step('THEN the Passenger 1 details section renders the required fields', async () => {
                    await expect(
                        flighthubCheckoutPage.passenger1Heading
                    ).toBeVisible();
                    await expect(
                        flighthubCheckoutPage.passenger1FirstNameInput
                    ).toBeVisible();
                    await expect(
                        flighthubCheckoutPage.passenger1SurnameInput
                    ).toBeVisible();
                    await expect(
                        flighthubCheckoutPage.passenger1DateOfBirthInput
                    ).toBeVisible();
                    await expect(
                        flighthubCheckoutPage.passenger1GenderSelect
                    ).toBeVisible();
                    await expect(
                        flighthubCheckoutPage.passenger1PhoneInput
                    ).toBeVisible();
                });

                await test.step('AND the passenger-name passport hint is shown', async () => {
                    await expect(
                        flighthubCheckoutPage.passengerNameHint
                    ).toBeVisible();
                });

                await test.step('AND the ticket-delivery section asks for an email', async () => {
                    await expect(
                        flighthubCheckoutPage.ticketDeliveryHeading
                    ).toBeVisible();
                    await expect(
                        flighthubCheckoutPage.emailInput
                    ).toBeVisible();
                });

                await test.step('AND the "Continue to payment" submit is rendered', async () => {
                    await expect(
                        flighthubCheckoutPage.continueToPaymentButton
                    ).toBeVisible();
                });
            }
        );

        test(
            'shows per-field validation when passenger details are empty',
            { tag: '@regression' },
            async ({ flighthubCheckoutPage }) => {
                await test.step('WHEN "Continue to payment" is pressed with every field blank', async () => {
                    await flighthubCheckoutPage.continueToPaymentButton.click();
                });

                // One submit feeds every assertion — running each row as
                // its own test would re-trigger the ~60s search → Select
                // → bundle → fare-upgrade setup against the live GDS.
                for (const {
                    field,
                    description,
                } of EMPTY_FORM_VALIDATION_CASES) {
                    await test.step(`THEN the inline error is shown when ${description}`, async () => {
                        await expect(
                            flighthubCheckoutPage.validationErrorFor(field)
                        ).toBeVisible();
                    });
                }
            }
        );

        test(
            'shows the invalid-email error when a malformed email is submitted',
            { tag: '@regression' },
            async ({ flighthubCheckoutPage }) => {
                await test.step('GIVEN a malformed email is typed into the ticket-delivery field', async () => {
                    await flighthubCheckoutPage.emailInput.fill('not-an-email');
                });

                await test.step('WHEN "Continue to payment" is pressed', async () => {
                    await flighthubCheckoutPage.continueToPaymentButton.click();
                });

                await test.step('THEN the "Invalid email address" error replaces the "required" error', async () => {
                    await expect(
                        flighthubCheckoutPage.emailInvalidError
                    ).toBeVisible();
                    await expect(
                        flighthubCheckoutPage.emailRequiredError
                    ).toHaveCount(0);
                });
            }
        );
    });
});
