import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages } from '../../../enums/justfly/justfly';
import {
    generateOneWaySearch,
    generateRoundTripSearch,
} from '../../../test-data/factories/justfly/search.factory';
import type { JustflyCabinClass } from '../../../pages/justfly/home.page';

// The form-driven tests validate that each interactive control populates
// the form correctly. They intentionally do NOT click the final Search
// button: the deep-link submit path (`submitOneWaySearch` /
// `submitRoundTripSearch`) is already exercised by `search.spec.ts`, and
// the in-page Search click on staging2 hands off to a Tripadvisor IFB
// anti-bot interstitial before the storefront's own `/flight/search`
// navigation completes — making any URL assertion non-deterministic in CI.
test.describe('justfly home page — form-driven controls', () => {
    test.beforeEach(async ({ justflyHomePage }) => {
        await justflyHomePage.open();
        await justflyHomePage.dismissCookieBanner();
    });

    test(
        'fills a one-way search form via every interactive control and verifies each field reflects the user input',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            const search = generateOneWaySearch({
                origin: 'YUL',
                destination: 'JFK',
                adults: 2,
                children: 1,
                infants: 0,
                cabin: 'Business',
            });

            await test.step('GIVEN the user activates the One-Way tab', async () => {
                await justflyHomePage.selectTripType('One Way');
            });

            await test.step('WHEN the user fills origin and destination via autocomplete', async () => {
                await justflyHomePage.selectAirport('origin', search.origin);
                await justflyHomePage.selectAirport(
                    'destination',
                    search.destination
                );
                await expect(justflyHomePage.originInput).toHaveValue(
                    new RegExp(`${search.origin}`)
                );
                await expect(justflyHomePage.destinationInput).toHaveValue(
                    new RegExp(`${search.destination}`)
                );
            });

            await test.step('AND picks a departure date from the calendar', async () => {
                await justflyHomePage.selectTripDates(search.departureDate);
                await expect(justflyHomePage.dateRangePicker).toBeHidden();
            });

            await test.step('AND sets the passenger counts via the popover', async () => {
                await justflyHomePage.setPassengerCounts({
                    adults: search.adults,
                    children: search.children,
                });
                await justflyHomePage.passengersInput.click();
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_ADULT_LABEL
                    )
                ).toHaveText(String(search.adults));
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_CHILD_LABEL
                    )
                ).toHaveText(String(search.children));
                await justflyHomePage.heroHeading.click();
            });

            await test.step('AND selects the cabin class from the dropdown', async () => {
                await justflyHomePage.selectCabin(
                    search.cabin as JustflyCabinClass
                );
                await expect(
                    justflyHomePage.cabinDropdownTriggerLabel
                ).toHaveText(Messages.HOME_CABIN_BUSINESS);
            });

            await test.step('THEN the Search button is the visible terminal control of the populated form', async () => {
                await expect(justflyHomePage.searchSubmit).toBeVisible();
            });
        }
    );

    test(
        'fills a round-trip search form via interactive controls and verifies both legs are picked from the calendar',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            const search = generateRoundTripSearch({
                origin: 'YUL',
                destination: 'YYZ',
            });

            await test.step('WHEN the user fills origin and destination via autocomplete', async () => {
                await justflyHomePage.selectAirport('origin', search.origin);
                await justflyHomePage.selectAirport(
                    'destination',
                    search.destination
                );
                await expect(justflyHomePage.originInput).toHaveValue(
                    new RegExp(`${search.origin}`)
                );
                await expect(justflyHomePage.destinationInput).toHaveValue(
                    new RegExp(`${search.destination}`)
                );
            });

            await test.step('AND picks both legs from the date-range picker', async () => {
                await justflyHomePage.selectTripDates(
                    search.departureDate,
                    search.returnDate
                );
                await expect(justflyHomePage.dateRangePicker).toBeHidden();
            });

            await test.step('THEN the round-trip Departing / Returning labels remain present and the Search button is visible', async () => {
                await expect(justflyHomePage.departingDatePicker).toBeVisible();
                await expect(justflyHomePage.returningDatePicker).toBeVisible();
                await expect(justflyHomePage.searchSubmit).toBeVisible();
            });
        }
    );

    test(
        'passenger popover increments and decrements per-pax-type counts',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            await test.step('WHEN the user opens the passenger popover and bumps every category', async () => {
                await justflyHomePage.setPassengerCounts({
                    adults: 3,
                    children: 2,
                    infantsOnSeat: 1,
                    infantsOnLap: 1,
                });
            });

            await test.step('THEN the popover rows show the per-pax-type counts the user dialed in', async () => {
                await justflyHomePage.passengersInput.click();
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_ADULT_LABEL
                    )
                ).toHaveText('3');
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_CHILD_LABEL
                    )
                ).toHaveText('2');
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_SEAT_LABEL
                    )
                ).toHaveText('1');
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_LAP_LABEL
                    )
                ).toHaveText('1');
                await justflyHomePage.heroHeading.click();
            });

            await test.step('AND the popover counters can be decremented back down to the default', async () => {
                await justflyHomePage.setPassengerCounts({
                    adults: 1,
                    children: 0,
                    infantsOnSeat: 0,
                    infantsOnLap: 0,
                });
                await justflyHomePage.passengersInput.click();
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_ADULT_LABEL
                    )
                ).toHaveText('1');
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_CHILD_LABEL
                    )
                ).toHaveText('0');
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_SEAT_LABEL
                    )
                ).toHaveText('0');
                await expect(
                    justflyHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_LAP_LABEL
                    )
                ).toHaveText('0');
                await justflyHomePage.heroHeading.click();
                await expect(justflyHomePage.passengersInput).toHaveValue(
                    Messages.HOME_PAX_DEFAULT_DISPLAY
                );
            });
        }
    );

    test(
        'cabin dropdown updates the trigger label to each cabin class',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            const cabinByLabel: Array<{
                cabin: JustflyCabinClass;
                label: Messages;
            }> = [
                {
                    cabin: 'Premium Economy',
                    label: Messages.HOME_CABIN_PREMIUM_ECONOMY,
                },
                { cabin: 'Business', label: Messages.HOME_CABIN_BUSINESS },
                { cabin: 'First', label: Messages.HOME_CABIN_FIRST },
                { cabin: 'Economy', label: Messages.HOME_CABIN_ECONOMY },
            ];

            for (const { cabin, label } of cabinByLabel) {
                await test.step(`THEN selecting ${cabin} updates the trigger label to "${label}"`, async () => {
                    await justflyHomePage.selectCabin(cabin);
                    await expect(
                        justflyHomePage.cabinDropdownTriggerLabel
                    ).toHaveText(label);
                });
            }
        }
    );

    test(
        'multi-city tab supports adding and removing slices',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            await test.step('GIVEN the Multi-City tab is active', async () => {
                await justflyHomePage.selectTripType('Multi-City');
                await expect(justflyHomePage.multiCityForm).toBeVisible();
                await expect(justflyHomePage.multiCitySliceTitles).toHaveCount(
                    2
                );
            });

            await test.step('WHEN the user adds a third slice', async () => {
                await justflyHomePage.addMultiCitySlice();
            });

            await test.step('THEN the slice count grows to 3', async () => {
                await expect(justflyHomePage.multiCitySliceTitles).toHaveCount(
                    3
                );
            });

            await test.step('WHEN the user removes the third slice', async () => {
                await justflyHomePage.removeMultiCitySlice(3);
            });

            await test.step('THEN the slice count returns to 2', async () => {
                await expect(justflyHomePage.multiCitySliceTitles).toHaveCount(
                    2
                );
            });
        }
    );

    test(
        'header chrome surfaces Support, My Trips, currency, hamburger and the Sign in dialog',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            await test.step('THEN the wide-layout header exposes the support and my-trips links', async () => {
                await expect(justflyHomePage.supportLink).toBeVisible();
                await expect(justflyHomePage.myTripsLink).toBeVisible();
                await expect(justflyHomePage.currencyDisplay).toBeVisible();
                await expect(
                    justflyHomePage.hamburgerMenuButton
                ).toBeAttached();
            });

            await test.step('WHEN the user clicks the Sign-in trigger', async () => {
                await justflyHomePage.signInButton.click();
            });

            await test.step('THEN the sign-in / register dialog surfaces with the three auth methods', async () => {
                await expect(justflyHomePage.signInDialogHeading).toBeVisible();
                await expect(
                    justflyHomePage.signInMethodButton('Email')
                ).toBeVisible();
                await expect(
                    justflyHomePage.signInMethodButton('Google')
                ).toBeVisible();
                await expect(
                    justflyHomePage.signInMethodButton('Apple')
                ).toBeVisible();
            });
        }
    );
});
