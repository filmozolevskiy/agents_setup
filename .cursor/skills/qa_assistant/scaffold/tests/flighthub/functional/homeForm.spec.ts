import { expect, test } from '../../../fixtures/pom/test-options';
import { Messages } from '../../../enums/flighthub/flighthub';
import {
    generateOneWaySearch,
    generateRoundTripSearch,
} from '../../../test-data/factories/flighthub/search.factory';
import type { FlighthubCabinClass } from '../../../pages/flighthub/home.page';

// The form-driven tests validate that each interactive control populates
// the form correctly. They intentionally do NOT click the final Search
// button: the deep-link submit path (`submitOneWaySearch` /
// `submitRoundTripSearch`) is already exercised by `search.spec.ts`, and
// the in-page Search click on staging2 hands off to a Tripadvisor IFB
// (`clicktripz` -> `tripadvisor.ca/SmartDeals`) anti-bot interstitial
// before the storefront's own `/flight/search` navigation completes —
// which would make any URL assertion non-deterministic in CI.
test.describe('flighthub home page — form-driven controls', () => {
    test.beforeEach(async ({ flighthubHomePage }) => {
        await flighthubHomePage.open();
        await flighthubHomePage.dismissCookieBanner();
    });

    test(
        'fills a one-way search form via every interactive control and verifies each field reflects the user input',
        { tag: '@regression' },
        async ({ flighthubHomePage }) => {
            const search = generateOneWaySearch({
                origin: 'YUL',
                destination: 'JFK',
                adults: 2,
                children: 1,
                infants: 0,
                cabin: 'Business',
            });

            await test.step('GIVEN the user activates the One-Way tab', async () => {
                await flighthubHomePage.selectTripType('One Way');
            });

            await test.step('WHEN the user fills origin and destination via autocomplete', async () => {
                await flighthubHomePage.selectAirport('origin', search.origin);
                await flighthubHomePage.selectAirport(
                    'destination',
                    search.destination
                );
                await expect(flighthubHomePage.originInput).toHaveValue(
                    new RegExp(`${search.origin}`)
                );
                await expect(flighthubHomePage.destinationInput).toHaveValue(
                    new RegExp(`${search.destination}`)
                );
            });

            await test.step('AND picks a departure date from the calendar', async () => {
                await flighthubHomePage.selectTripDates(search.departureDate);
                await expect(flighthubHomePage.dateRangePicker).toBeHidden();
            });

            await test.step('AND sets the passenger counts via the popover', async () => {
                await flighthubHomePage.setPassengerCounts({
                    adults: search.adults,
                    children: search.children,
                });
                await flighthubHomePage.passengersInput.click();
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_ADULT_LABEL
                    )
                ).toHaveText(String(search.adults));
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_CHILD_LABEL
                    )
                ).toHaveText(String(search.children));
                await flighthubHomePage.heroHeading.click();
            });

            await test.step('AND selects the cabin class from the dropdown', async () => {
                await flighthubHomePage.selectCabin(
                    search.cabin as FlighthubCabinClass
                );
                await expect(
                    flighthubHomePage.cabinDropdownTriggerLabel
                ).toHaveText(Messages.HOME_CABIN_BUSINESS);
            });

            await test.step('THEN the Search button is the visible terminal control of the populated form', async () => {
                await expect(flighthubHomePage.searchSubmit).toBeVisible();
            });
        }
    );

    test(
        'fills a round-trip search form via interactive controls and verifies both legs are picked from the calendar',
        { tag: '@regression' },
        async ({ flighthubHomePage }) => {
            const search = generateRoundTripSearch({
                origin: 'YUL',
                destination: 'YYZ',
            });

            await test.step('WHEN the user fills origin and destination via autocomplete', async () => {
                await flighthubHomePage.selectAirport('origin', search.origin);
                await flighthubHomePage.selectAirport(
                    'destination',
                    search.destination
                );
                await expect(flighthubHomePage.originInput).toHaveValue(
                    new RegExp(`${search.origin}`)
                );
                await expect(flighthubHomePage.destinationInput).toHaveValue(
                    new RegExp(`${search.destination}`)
                );
            });

            await test.step('AND picks both legs from the date-range picker', async () => {
                await flighthubHomePage.selectTripDates(
                    search.departureDate,
                    search.returnDate
                );
                await expect(flighthubHomePage.dateRangePicker).toBeHidden();
            });

            await test.step('THEN the round-trip Departing / Returning labels remain present and the Search button is visible', async () => {
                await expect(
                    flighthubHomePage.departingDatePicker
                ).toBeVisible();
                await expect(
                    flighthubHomePage.returningDatePicker
                ).toBeVisible();
                await expect(flighthubHomePage.searchSubmit).toBeVisible();
            });
        }
    );

    test(
        'passenger popover increments and decrements per-pax-type counts',
        { tag: '@regression' },
        async ({ flighthubHomePage }) => {
            await test.step('WHEN the user opens the passenger popover and bumps every category', async () => {
                await flighthubHomePage.setPassengerCounts({
                    adults: 3,
                    children: 2,
                    infantsOnSeat: 1,
                    infantsOnLap: 1,
                });
            });

            await test.step('THEN the popover rows show the per-pax-type counts the user dialed in', async () => {
                await flighthubHomePage.passengersInput.click();
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_ADULT_LABEL
                    )
                ).toHaveText('3');
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_CHILD_LABEL
                    )
                ).toHaveText('2');
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_SEAT_LABEL
                    )
                ).toHaveText('1');
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_LAP_LABEL
                    )
                ).toHaveText('1');
                await flighthubHomePage.heroHeading.click();
            });

            await test.step('AND the popover counters can be decremented back down to the default', async () => {
                await flighthubHomePage.setPassengerCounts({
                    adults: 1,
                    children: 0,
                    infantsOnSeat: 0,
                    infantsOnLap: 0,
                });
                await flighthubHomePage.passengersInput.click();
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_ADULT_LABEL
                    )
                ).toHaveText('1');
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_CHILD_LABEL
                    )
                ).toHaveText('0');
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_SEAT_LABEL
                    )
                ).toHaveText('0');
                await expect(
                    flighthubHomePage.passengerCount(
                        Messages.HOME_PAX_INFANT_LAP_LABEL
                    )
                ).toHaveText('0');
                await flighthubHomePage.heroHeading.click();
                await expect(flighthubHomePage.passengersInput).toHaveValue(
                    Messages.HOME_PAX_DEFAULT_DISPLAY
                );
            });
        }
    );

    test(
        'cabin dropdown updates the trigger label to each cabin class',
        { tag: '@regression' },
        async ({ flighthubHomePage }) => {
            const cabinByLabel: Array<{
                cabin: FlighthubCabinClass;
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
                    await flighthubHomePage.selectCabin(cabin);
                    await expect(
                        flighthubHomePage.cabinDropdownTriggerLabel
                    ).toHaveText(label);
                });
            }
        }
    );

    test(
        'multi-city tab supports adding and removing slices',
        { tag: '@regression' },
        async ({ flighthubHomePage }) => {
            await test.step('GIVEN the Multi-City tab is active', async () => {
                await flighthubHomePage.selectTripType('Multi-City');
                await expect(flighthubHomePage.multiCityForm).toBeVisible();
                await expect(
                    flighthubHomePage.multiCitySliceTitles
                ).toHaveCount(2);
            });

            await test.step('WHEN the user adds a third slice', async () => {
                await flighthubHomePage.addMultiCitySlice();
            });

            await test.step('THEN the slice count grows to 3', async () => {
                await expect(
                    flighthubHomePage.multiCitySliceTitles
                ).toHaveCount(3);
            });

            await test.step('WHEN the user removes the third slice', async () => {
                await flighthubHomePage.removeMultiCitySlice(3);
            });

            await test.step('THEN the slice count returns to 2', async () => {
                await expect(
                    flighthubHomePage.multiCitySliceTitles
                ).toHaveCount(2);
            });
        }
    );

    test(
        'header chrome surfaces Support, My Trips, currency, hamburger and the Sign in dialog',
        { tag: '@regression' },
        async ({ flighthubHomePage }) => {
            await test.step('THEN the wide-layout header exposes the support and my-trips links', async () => {
                await expect(flighthubHomePage.supportLink).toBeVisible();
                await expect(flighthubHomePage.myTripsLink).toBeVisible();
                await expect(flighthubHomePage.currencyDisplay).toBeVisible();
                await expect(
                    flighthubHomePage.hamburgerMenuButton
                ).toBeAttached();
            });

            await test.step('WHEN the user clicks the Sign-in trigger', async () => {
                await flighthubHomePage.signInButton.click();
            });

            await test.step('THEN the sign-in / register dialog surfaces with the three auth methods', async () => {
                await expect(
                    flighthubHomePage.signInDialogHeading
                ).toBeVisible();
                await expect(
                    flighthubHomePage.signInMethodButton('Email')
                ).toBeVisible();
                await expect(
                    flighthubHomePage.signInMethodButton('Google')
                ).toBeVisible();
                await expect(
                    flighthubHomePage.signInMethodButton('Apple')
                ).toBeVisible();
            });
        }
    );
});
