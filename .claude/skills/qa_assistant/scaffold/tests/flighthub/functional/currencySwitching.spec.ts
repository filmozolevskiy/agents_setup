import { expect, test } from '../../../fixtures/pom/test-options';
import {
    Messages,
    SupportedCurrency,
    COUNTRY_FOR_CURRENCY,
} from '../../../enums/flighthub/flighthub';
import { generateOneWaySearch } from '../../../test-data/factories/flighthub/search.factory';

test.describe('flighthub header — language and currency dialog', () => {
    test.beforeEach(async ({ flighthubHomePage }) => {
        await flighthubHomePage.open();
        await flighthubHomePage.dismissCookieBanner();
    });

    // Flighthub's Country / Region listbox exposes only US / CA / UK
    // (verified live 2026-05-10) — three currencies vs JustFly's four.
    // The data-driven loop below reflects exactly the brand's surface.
    for (const currency of Object.values(SupportedCurrency)) {
        test(
            `switches the storefront currency to ${currency} via the language and currency dialog`,
            { tag: '@regression' },
            async ({ flighthubHomePage, page }) => {
                const country = COUNTRY_FOR_CURRENCY[currency];
                // Force a known-different starting state so the Save
                // button reliably becomes enabled when the test picks
                // `country` below. Without this, picking the
                // currently-selected country is a no-op (Save stays
                // disabled) and the test fails on whichever currency
                // matches the GeoIP / cookie default — CAD on staging2
                // for a CA worker, USD on prod for a US worker, etc.
                // Seed the storefront with a known-different currency
                // by replaying the same `?language=...&country=...&currency=...`
                // query the dialog itself sets on Save. This makes the
                // server set the persistence cookies and persist the
                // choice — confirmed live 2026-05-10. Plain
                // `addCookies` is insufficient because the storefront
                // re-derives currency from server-side headers /
                // GeoIP on first request when no query param is
                // present.
                /* eslint-disable playwright/no-conditional-in-test -- seed currency / country must differ from the target currency; conditionals are tied to the runtime currency value and cannot be hoisted out. */
                const seedCurrency =
                    currency === SupportedCurrency.CAD
                        ? SupportedCurrency.USD
                        : SupportedCurrency.CAD;
                const seedCountry =
                    seedCurrency === SupportedCurrency.USD ? 'us' : 'ca';
                /* eslint-enable playwright/no-conditional-in-test */
                await page.goto(
                    `/?language=en&country=${seedCountry}&currency=${seedCurrency}`
                );
                await flighthubHomePage.dismissCookieBanner();
                await expect(flighthubHomePage.currencyDisplay).toHaveText(
                    seedCurrency
                );

                await test.step('GIVEN the user opens the language and currency dialog from the header', async () => {
                    await flighthubHomePage.currencyDisplay.click();
                    await expect(
                        flighthubHomePage.currencyDialog
                    ).toBeVisible();
                });

                await test.step(`WHEN the user picks ${country} from the country / region listbox`, async () => {
                    await flighthubHomePage.currencyDialogCountryTrigger.click();
                    await expect(
                        flighthubHomePage.currencyDialogCountryListbox
                    ).toBeVisible();
                    await flighthubHomePage
                        .currencyDialogCountryOption(country)
                        .click();
                });

                await test.step('AND the Save button becomes enabled', async () => {
                    await expect(
                        flighthubHomePage.currencyDialogSaveButton
                    ).toBeEnabled();
                });

                await test.step('AND the user clicks Save', async () => {
                    await flighthubHomePage.currencyDialogSaveButton.click();
                });

                await test.step(`THEN the dialog closes and the header reflects ${currency}`, async () => {
                    await expect(flighthubHomePage.currencyDialog).toBeHidden();
                    await expect(flighthubHomePage.currencyDisplay).toHaveText(
                        currency
                    );
                });

                await test.step(`AND the URL carries the currency=${currency} query parameter`, async () => {
                    await expect(page).toHaveURL(
                        new RegExp(`currency=${currency}`)
                    );
                });

                await test.step(`AND the persistence cookies currency=${currency} and display_currency=${currency.toLowerCase()} are set on the brand domain`, async () => {
                    // The genesis storefront persists the currency choice
                    // through three cookies on `.flighthub.com` —
                    // `country` (proprietary code), `currency`
                    // (ISO-4217 uppercase), and `display_currency`
                    // (lowercase duplicate consumed by the price
                    // formatter). The first two of the three are the
                    // contract that `genesis` reads back on the next
                    // request — assert those exactly. `country` carries
                    // an opaque code (`us` / `ca` / `gb`) that varies
                    // by brand convention; just assert non-empty.
                    const cookies = await page.context().cookies();
                    const byName = (name: string): string | undefined =>
                        cookies.find((c) => c.name === name)?.value;
                    expect(byName('currency')).toBe(currency);
                    expect(byName('display_currency')).toBe(
                        currency.toLowerCase()
                    );
                    expect(byName('country')).toBeTruthy();
                });

                await test.step(`AND the choice survives a plain navigation back to /`, async () => {
                    await flighthubHomePage.open();
                    await expect(flighthubHomePage.currencyDisplay).toHaveText(
                        currency
                    );
                });
            }
        );
    }

    test(
        'cancelling the language and currency dialog leaves the active currency untouched',
        { tag: '@regression' },
        async ({ flighthubHomePage }) => {
            const before =
                await flighthubHomePage.currencyDisplay.textContent();
            expect(before?.trim()).toMatch(/^(USD|CAD|GBP)$/);

            await test.step('GIVEN the user opens the dialog and stages a different country', async () => {
                await flighthubHomePage.currencyDisplay.click();
                await expect(flighthubHomePage.currencyDialog).toBeVisible();
                await flighthubHomePage.currencyDialogCountryTrigger.click();
                await expect(
                    flighthubHomePage.currencyDialogCountryListbox
                ).toBeVisible();
                /* eslint-disable playwright/no-conditional-in-test -- starting currency varies by GeoIP / cookies; flipping CA ↔ US keeps the Save button reliably enabled across environments. */
                const targetCountry =
                    before?.trim() === SupportedCurrency.USD
                        ? COUNTRY_FOR_CURRENCY[SupportedCurrency.CAD]
                        : COUNTRY_FOR_CURRENCY[SupportedCurrency.USD];
                await flighthubHomePage
                    .currencyDialogCountryOption(targetCountry)
                    .click();
                /* eslint-enable playwright/no-conditional-in-test */
                await expect(
                    flighthubHomePage.currencyDialogSaveButton
                ).toBeEnabled();
            });

            await test.step('WHEN the user clicks Cancel', async () => {
                await flighthubHomePage.currencyDialogCancelButton.click();
            });

            await test.step('THEN the dialog closes and the header currency is unchanged', async () => {
                await expect(flighthubHomePage.currencyDialog).toBeHidden();
                await expect(flighthubHomePage.currencyDisplay).toHaveText(
                    before!.trim()
                );
            });
        }
    );

    test(
        'currency selection persists across a search submission and surfaces the currency token in result-card prices',
        { tag: '@regression' },
        async ({ flighthubHomePage, flighthubSearchResultsPage }) => {
            // Live GDS search on staging2 routinely takes 30-60s; mirror
            // the 180s budget from `searchResultsFilters.spec.ts`.
            test.setTimeout(180000);

            await test.step('GIVEN the user switches the storefront currency to USD', async () => {
                await flighthubHomePage.selectCurrency(SupportedCurrency.USD);
            });

            await test.step('WHEN the user submits a one-way search', async () => {
                const search = generateOneWaySearch({
                    origin: 'YUL',
                    destination: 'JFK',
                });
                await flighthubHomePage.submitOneWaySearch(search);
                await flighthubSearchResultsPage.dismissInterruptions();
                await flighthubSearchResultsPage.waitForResults();
                await flighthubSearchResultsPage.dismissInterruptions();
            });

            await test.step('THEN the first result card price renders with the USD token', async () => {
                await expect(
                    flighthubSearchResultsPage.resultCardPrice(0)
                ).toContainText(SupportedCurrency.USD);
            });

            await test.step('AND the search-results header still reflects the active currency (USD)', async () => {
                await expect(flighthubHomePage.currencyDisplay).toHaveText(
                    SupportedCurrency.USD
                );
            });

            await test.step('AND opening the dialog from the search-results page still shows the Language and Currency heading', async () => {
                await flighthubHomePage.currencyDisplay.click();
                await expect(flighthubHomePage.currencyDialog).toBeVisible();
                await expect(
                    flighthubHomePage.currencyDialog.getByText(
                        Messages.HEADER_CURRENCY_DIALOG_HEADING,
                        { exact: true }
                    )
                ).toBeVisible();
                await flighthubHomePage.currencyDialogCancelButton.click();
            });
        }
    );
});
