import { expect, test } from '../../../fixtures/pom/test-options';
import {
    Messages,
    SupportedCurrency,
    COUNTRY_FOR_CURRENCY,
} from '../../../enums/justfly/justfly';
import { generateOneWaySearch } from '../../../test-data/factories/justfly/search.factory';
import { SEARCH_TEST_TIMEOUT_MS } from '../../../pages/justfly/searchResults.page';

test.describe('justfly header — language and currency dialog', () => {
    test.beforeEach(async ({ justflyHomePage }) => {
        await justflyHomePage.open();
        await justflyHomePage.dismissCookieBanner();
    });

    // Switching countries triggers a same-origin reload; data-driven
    // loop covers one currency per test, since the storefront persists
    // the choice via cookies on `.justfly.com` and the fixture's
    // BrowserContext is shared across steps but isolated across tests.
    for (const currency of Object.values(SupportedCurrency)) {
        test(
            `switches the storefront currency to ${currency} via the language and currency dialog`,
            { tag: '@regression' },
            async ({ justflyHomePage, page }) => {
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
                await justflyHomePage.dismissCookieBanner();
                await expect(justflyHomePage.currencyDisplay).toHaveText(
                    seedCurrency
                );

                await test.step('GIVEN the user opens the language and currency dialog from the header', async () => {
                    await justflyHomePage.currencyDisplay.click();
                    await expect(justflyHomePage.currencyDialog).toBeVisible();
                });

                await test.step(`WHEN the user picks ${country} from the country / region listbox`, async () => {
                    await justflyHomePage.currencyDialogCountryTrigger.click();
                    await expect(
                        justflyHomePage.currencyDialogCountryListbox
                    ).toBeVisible();
                    await justflyHomePage
                        .currencyDialogCountryOption(country)
                        .click();
                });

                await test.step('AND the Save button becomes enabled', async () => {
                    await expect(
                        justflyHomePage.currencyDialogSaveButton
                    ).toBeEnabled();
                });

                await test.step('AND the user clicks Save', async () => {
                    await justflyHomePage.currencyDialogSaveButton.click();
                });

                await test.step(`THEN the dialog closes and the header reflects ${currency}`, async () => {
                    await expect(justflyHomePage.currencyDialog).toBeHidden();
                    await expect(justflyHomePage.currencyDisplay).toHaveText(
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
                    // through three cookies on `.justfly.com` — `country`
                    // (ISO-2 / proprietary code), `currency` (ISO-4217
                    // uppercase), and `display_currency` (lowercase
                    // duplicate consumed by the price formatter). The
                    // first two of the three are the contract that
                    // `genesis` reads back on the next request — assert
                    // those exactly. `country` carries an opaque code
                    // (`us` / `ca` / `gb` / `fr` / `ie`) that varies by
                    // brand convention; just assert non-empty.
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
                    await justflyHomePage.open();
                    await expect(justflyHomePage.currencyDisplay).toHaveText(
                        currency
                    );
                });
            }
        );
    }

    test(
        'cancelling the language and currency dialog leaves the active currency untouched',
        { tag: '@regression' },
        async ({ justflyHomePage }) => {
            const before = await justflyHomePage.currencyDisplay.textContent();
            expect(before?.trim()).toMatch(/^(USD|CAD|GBP|EUR)$/);

            await test.step('GIVEN the user opens the dialog and stages a different country', async () => {
                await justflyHomePage.currencyDisplay.click();
                await expect(justflyHomePage.currencyDialog).toBeVisible();
                await justflyHomePage.currencyDialogCountryTrigger.click();
                await expect(
                    justflyHomePage.currencyDialogCountryListbox
                ).toBeVisible();
                /* eslint-disable playwright/no-conditional-in-test -- starting currency varies by GeoIP / cookies; flipping CA ↔ US keeps the Save button reliably enabled across environments. */
                const targetCountry =
                    before?.trim() === SupportedCurrency.USD
                        ? COUNTRY_FOR_CURRENCY[SupportedCurrency.CAD]
                        : COUNTRY_FOR_CURRENCY[SupportedCurrency.USD];
                await justflyHomePage
                    .currencyDialogCountryOption(targetCountry)
                    .click();
                /* eslint-enable playwright/no-conditional-in-test */
                await expect(
                    justflyHomePage.currencyDialogSaveButton
                ).toBeEnabled();
            });

            await test.step('WHEN the user clicks Cancel', async () => {
                await justflyHomePage.currencyDialogCancelButton.click();
            });

            await test.step('THEN the dialog closes and the header currency is unchanged', async () => {
                await expect(justflyHomePage.currencyDialog).toBeHidden();
                await expect(justflyHomePage.currencyDisplay).toHaveText(
                    before!.trim()
                );
            });
        }
    );

    test(
        'france and Ireland both map to EUR — two countries, one currency',
        { tag: '@regression' },
        async ({ justflyHomePage, page }) => {
            // JustFly's Country / Region listbox exposes both France and
            // Ireland, and both yield EUR. Flighthub does not expose
            // either (no EUR option) — this case is JustFly-only.
            await test.step('GIVEN the user picks Ireland from the country / region listbox', async () => {
                await justflyHomePage.currencyDisplay.click();
                await expect(justflyHomePage.currencyDialog).toBeVisible();
                await justflyHomePage.currencyDialogCountryTrigger.click();
                await expect(
                    justflyHomePage.currencyDialogCountryListbox
                ).toBeVisible();
                await justflyHomePage
                    .currencyDialogCountryOption('Ireland')
                    .click();
            });

            await test.step('WHEN the user clicks Save', async () => {
                await justflyHomePage.currencyDialogSaveButton.click();
            });

            await test.step('THEN the header currency is EUR', async () => {
                await expect(justflyHomePage.currencyDialog).toBeHidden();
                await expect(justflyHomePage.currencyDisplay).toHaveText(
                    SupportedCurrency.EUR
                );
                await expect(page).toHaveURL(
                    new RegExp(`currency=${SupportedCurrency.EUR}`)
                );
            });

            await test.step('AND switching to France keeps the same currency (EUR)', async () => {
                await justflyHomePage.currencyDisplay.click();
                await expect(justflyHomePage.currencyDialog).toBeVisible();
                await justflyHomePage.currencyDialogCountryTrigger.click();
                await expect(
                    justflyHomePage.currencyDialogCountryListbox
                ).toBeVisible();
                await justflyHomePage
                    .currencyDialogCountryOption('France')
                    .click();
                await justflyHomePage.currencyDialogSaveButton.click();
                await expect(justflyHomePage.currencyDialog).toBeHidden();
                await expect(justflyHomePage.currencyDisplay).toHaveText(
                    SupportedCurrency.EUR
                );
            });
        }
    );

    test(
        'currency selection persists across a search submission and surfaces the currency token in result-card prices',
        { tag: '@regression' },
        async ({ justflyHomePage, justflySearchResultsPage }) => {
            // Live GDS search on staging2 routinely takes 30-60s; the
            // global 60s test timeout is too tight once a currency
            // switch has triggered an upstream re-fetch. Mirror the
            // budget used in `searchResultsFilters.spec.ts`.
            test.setTimeout(SEARCH_TEST_TIMEOUT_MS);

            await test.step('GIVEN the user switches the storefront currency to USD', async () => {
                await justflyHomePage.selectCurrency(SupportedCurrency.USD);
            });

            await test.step('WHEN the user submits a one-way search', async () => {
                const search = generateOneWaySearch({
                    origin: 'YUL',
                    destination: 'JFK',
                });
                await justflyHomePage.submitOneWaySearch(search);
                await justflySearchResultsPage.dismissInterruptions();
                await justflySearchResultsPage.waitForResults();
                await justflySearchResultsPage.dismissInterruptions();
            });

            await test.step('THEN the first result card price renders with the USD token', async () => {
                await expect(
                    justflySearchResultsPage.resultCardPrice(0)
                ).toContainText(SupportedCurrency.USD);
            });

            // The Search-Results header carries the currency code as
            // part of its own bottom-bar — visible on both staging and
            // prod via the same `.navbar-language-selector` hook.
            await test.step('AND the search-results header still reflects the active currency (USD)', async () => {
                await expect(justflyHomePage.currencyDisplay).toHaveText(
                    SupportedCurrency.USD
                );
            });

            // The dialog heading is brand-symmetric — keeping a sanity
            // check here guards against a future storefront refactor
            // that swaps the heading copy without updating the enum.
            await test.step('AND opening the dialog from the search-results page still shows the Language and Currency heading', async () => {
                await justflyHomePage.currencyDisplay.click();
                await expect(justflyHomePage.currencyDialog).toBeVisible();
                await expect(
                    justflyHomePage.currencyDialog.getByText(
                        Messages.HEADER_CURRENCY_DIALOG_HEADING,
                        { exact: true }
                    )
                ).toBeVisible();
                await justflyHomePage.currencyDialogCancelButton.click();
            });
        }
    );
});
