import { Locator, Page, expect } from '@playwright/test';
import {
    Messages,
    Routes,
    SupportedCurrency,
    COUNTRY_FOR_CURRENCY,
} from '../../enums/justfly/justfly';

export type JustflyTripType = 'Round Trip' | 'One Way' | 'Multi-City';

export type JustflyCabinClass =
    | 'Economy'
    | 'Premium Economy'
    | 'Business'
    | 'First';

export interface JustflySearchInputs {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate?: string;
    cabin?: JustflyCabinClass;
    adults?: number;
    children?: number;
    infants?: number;
}

/**
 * Per-pax-type counters surfaced by the home-page passengers popover.
 * The genesis storefront treats `infantsOnSeat` and `infantsOnLap` as
 * separate counts — they map to distinct URL params (`num_infants` and
 * `num_infants_lap`) and have different fare-class implications.
 */
export type JustflyPaxType =
    | 'adults'
    | 'children'
    | 'infantsOnSeat'
    | 'infantsOnLap';

export interface JustflyPassengerCounts {
    adults?: number;
    children?: number;
    infantsOnSeat?: number;
    infantsOnLap?: number;
}

export class JustflyHomePage {
    constructor(private readonly page: Page) {}

    // ==================== Locators ====================

    get heroHeading(): Locator {
        return this.page.getByText(Messages.HOME_HEADING, { exact: true });
    }

    get roundTripTab(): Locator {
        return this.page.getByText('Round Trip', { exact: true });
    }

    get oneWayTab(): Locator {
        return this.page.getByText('One Way', { exact: true });
    }

    get multiCityTab(): Locator {
        return this.page.getByText('Multi-City', { exact: true });
    }

    get originInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Leaving from' });
    }

    get destinationInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Going to' });
    }

    get departingDatePicker(): Locator {
        return this.page.getByText('Departing', { exact: true });
    }

    get returningDatePicker(): Locator {
        return this.page.getByText('Returning', { exact: true });
    }

    // Round-trip renders `Departing`+`Returning` pair, one-way renders a single `Date` —
    // both open the same popover. `.or()` keeps the locator variant-agnostic.
    get dateTrigger(): Locator {
        return this.departingDatePicker.or(
            this.page.getByText('Date', { exact: true })
        );
    }

    get passengersInput(): Locator {
        return this.page.getByRole('textbox', { name: 'Passenger(s)' });
    }

    get searchSubmit(): Locator {
        // The submit control varies across storefront responsive variants:
        // a real `<button>` in the compact layout, a styled `<div>` with
        // "Search" text in `<form>` in the wide layout. `.or()` covers
        // both without forcing a viewport assumption on every test.
        /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods */
        return this.page
            .getByRole('button', { name: 'Search', exact: true })
            .or(
                this.page
                    .locator('form')
                    .getByText('Search', { exact: true })
                    .first()
            );
        /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */
    }

    get originClearButton(): Locator {
        // The × glyph has no a11y name on staging2 — it renders as a bare
        // `<div class="close-btn">`, so a raw class locator is the only
        // option. Two parent classes are accepted because the storefront
        // ships both `.origin` (wide layout) and `.departure` (compact
        // layout) as the parent of the same control.
        /* eslint-disable playwright/no-raw-locators */
        return this.page
            .locator('.search-form-input.origin .close-btn')
            .or(this.page.locator('.search-form-input.departure .close-btn'));
        /* eslint-enable playwright/no-raw-locators */
    }

    get destinationClearButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- × glyph has no a11y name on staging2.
        return this.page.locator('.search-form-input.destination .close-btn');
    }

    // ==================== Date picker ====================

    get dateRangePicker(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- popover root has no semantic role.
        return this.page.locator('.date-picker');
    }

    get dateRangePickerCalendar(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- react-date-range root has no semantic role.
        return this.dateRangePicker.locator('.rdrCalendarWrapper');
    }

    get dateRangePickerPrevMonthButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- nav buttons have no a11y name (icon-only); class is the only stable hook.
        return this.dateRangePicker.locator('.rdrPprevButton');
    }

    get dateRangePickerNextMonthButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- icon-only nav button.
        return this.dateRangePicker.locator('.rdrNextButton');
    }

    get dateRangePickerSetDatesButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- bespoke storefront control; not a semantic button by name.
        return this.dateRangePicker.locator('.set-dates-btn');
    }

    get dateRangePickerClearButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- `.date-picker-cta-clear` is the only stable hook for the Clear control.
        return this.dateRangePicker.locator('.date-picker-cta-clear');
    }

    // Two months render side-by-side; callers MUST disambiguate via monthLabel
    // (e.g. `'Jun 2026'`) before reaching a day cell.
    dateRangePickerMonth(monthLabel: string): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- .rdrMonth is the panel wrapper; the public month-label text is the disambiguator.
        return this.dateRangePickerCalendar
            .locator('.rdrMonth')
            .filter({ has: this.page.getByText(monthLabel, { exact: true }) });
    }

    dateRangePickerDay(monthLabel: string, day: number): Locator {
        return this.dateRangePickerMonth(monthLabel)
            .getByRole('button', { name: String(day), exact: true })
            .and(
                // eslint-disable-next-line playwright/no-raw-locators -- passive/disabled cells are class-based; no accessibility-tree way to filter.
                this.page.locator(
                    'button.rdrDay:not(.rdrDayPassive):not(.rdrDayDisabled)'
                )
            );
    }

    // ==================== Passengers popover ====================

    get passengersPopover(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- popover has no semantic role; the dropdown-item rows are scoped through this wrapper.
        return this.page.locator('.passenger-dropdown');
    }

    passengerRow(label: string): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- dropdown-item is the row wrapper.
        return this.page.locator('.dropdown-item').filter({ hasText: label });
    }

    /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods --
       Minus / plus controls are unsemantic <div>s with class `.plus-minus`;
       index-based ordering (minus first, plus second) is the storefront's
       documented row layout, and the count display is the unlabelled middle
       div between them. No semantic alternative on staging2. */
    passengerMinusButton(label: string): Locator {
        return this.passengerRow(label).locator('.plus-minus').first();
    }

    passengerPlusButton(label: string): Locator {
        return this.passengerRow(label).locator('.plus-minus').nth(1);
    }

    passengerCount(label: string): Locator {
        return this.passengerRow(label)
            .locator('.passenger-counter > div')
            .nth(1);
    }
    /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */

    // ==================== Cabin dropdown ====================

    get cabinDropdownTrigger(): Locator {
        // The form ships two `.search-form-selector` blocks: one for the
        // product-type tabs (`Flights / Hotels / Cars / Cruises`) above
        // the form, and one for the cabin class inside the form. The
        // cabin trigger is the only one nested inside
        // `.home-search-form-selector-wrapper`, so scope through it.
        // eslint-disable-next-line playwright/no-raw-locators -- the trigger is a div, not a button.
        return this.page.locator(
            '.home-search-form-selector-wrapper .search-form-selector'
        );
    }

    get cabinDropdownTriggerLabel(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- inner span carries the currently-selected cabin name.
        return this.cabinDropdownTrigger.locator(
            '.search-form-selector__inner'
        );
    }

    cabinOption(displayName: string): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- option panel is rendered inside the trigger; the items are bare `<div>`s with no semantic role.
        const optionPanel = this.cabinDropdownTrigger.locator(
            '.search-form-selector-list'
        );
        return optionPanel.getByText(displayName, { exact: true });
    }

    // ==================== Multi-City ====================

    get multiCityForm(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- multi-city form variant has a class but no role.
        return this.page.locator('.flight-search-form.multi-city-form');
    }

    multiCitySlice(idx: number): Locator {
        /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods */
        return this.multiCityForm
            .locator('.search-input-wrapper.flights')
            .nth(idx - 1);
        /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */
    }

    multiCitySliceOriginInput(idx: number): Locator {
        return this.multiCitySlice(idx).getByRole('textbox', {
            name: 'Leaving from',
        });
    }

    multiCitySliceDestinationInput(idx: number): Locator {
        return this.multiCitySlice(idx).getByRole('textbox', {
            name: 'Going to',
        });
    }

    multiCitySliceDateTrigger(idx: number): Locator {
        return this.multiCitySlice(idx).getByText('Date', { exact: true });
    }

    multiCitySliceRemoveLink(idx: number): Locator {
        return this.multiCityForm
            .getByText(`${Messages.HOME_MULTI_CITY_SLICE_TITLE_PREFIX}${idx}`, {
                exact: false,
            })
            .getByText('Remove', { exact: true });
    }

    get multiCitySliceAddButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- "+ add city, airport" tile has no role; class is stable.
        return this.multiCityForm.locator('.search-form-segment-add');
    }

    get multiCitySliceTitles(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- title is a class-only div.
        return this.multiCityForm.locator('.search-form-segment-title');
    }

    // ==================== Header chrome ====================

    get headerNav(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators, playwright/no-nth-methods -- wide-layout nav is a class-only div on staging2.
        return this.page.locator('.header-content-wrapper').first();
    }

    get supportLink(): Locator {
        // eslint-disable-next-line playwright/no-nth-methods -- nav link is duplicated for wide / mobile layouts.
        return this.page.getByRole('link', { name: 'Support' }).first();
    }

    get myTripsLink(): Locator {
        // eslint-disable-next-line playwright/no-nth-methods -- mobile / wide duplication.
        return this.page.getByRole('link', { name: 'My Trips' }).first();
    }

    get currencyDisplay(): Locator {
        // The header surfaces the currently-selected currency code
        // (CAD / USD / GBP / EUR) on a stable `.navbar-language-selector`
        // class — verified live via `playwright-cli` 2026-05-10. Prior
        // implementation hardcoded `getByText('CAD')`, which silently
        // missed any prod / non-CA-GeoIP run that defaults to USD.
        // eslint-disable-next-line playwright/no-raw-locators, playwright/no-nth-methods -- class hook is the only role-agnostic anchor; .first() targets the visible wide-layout copy across the burger / wide duplication.
        return this.page.locator('.navbar-language-selector').first();
    }

    /**
     * Modal opened by clicking `currencyDisplay`. The storefront does
     * not name the dialog (`role=dialog` with no `aria-label`), so the
     * locator filters by the heading text. Both brands share the
     * `Language and Currency` heading — verified live 2026-05-10.
     */
    get currencyDialog(): Locator {
        return this.page.getByRole('dialog').filter({
            hasText: Messages.HEADER_CURRENCY_DIALOG_HEADING,
        });
    }

    /**
     * Clickable Country / Region row inside `currencyDialog`. Currency
     * is read-only — it follows whichever country is selected here.
     * The row is the immediate sibling of the static
     * `Country / Region` label generic.
     */
    get currencyDialogCountryTrigger(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- the row is unnamed; XPath-following-sibling against the static label is the smallest stable expression.
        return this.currencyDialog
            .getByText(Messages.HEADER_CURRENCY_DIALOG_COUNTRY_REGION_LABEL, {
                exact: true,
            })
            .locator('xpath=following-sibling::*[1]');
    }

    /**
     * Listbox that expands inside `currencyDialogCountryTrigger` once
     * clicked. Hosts one `role=option` per supported country
     * (Flighthub: 3, JustFly: 5).
     */
    get currencyDialogCountryListbox(): Locator {
        return this.currencyDialog.getByRole('listbox');
    }

    /**
     * Resolves a single country option in `currencyDialogCountryListbox`
     * by its visible label (e.g. `'United States'`, `'Canada'`,
     * `'United Kingdom'`, `'France'`, `'Ireland'`).
     *
     * @param country - Country / region label as rendered in the listbox.
     */
    currencyDialogCountryOption(country: string): Locator {
        return this.currencyDialog.getByRole('option', {
            name: country,
            exact: true,
        });
    }

    get currencyDialogSaveButton(): Locator {
        return this.currencyDialog.getByRole('button', {
            name: Messages.HEADER_CURRENCY_DIALOG_SAVE,
            exact: true,
        });
    }

    get currencyDialogCancelButton(): Locator {
        return this.currencyDialog.getByRole('button', {
            name: Messages.HEADER_CURRENCY_DIALOG_CANCEL,
            exact: true,
        });
    }

    get signInButton(): Locator {
        // eslint-disable-next-line playwright/no-nth-methods -- wide-layout vs burger-nav duplicate.
        return this.page.getByText('Sign in', { exact: true }).first();
    }

    get hamburgerMenuButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- burger toggle is a class-only div without a11y name on staging2.
        return this.page.locator('.sunshine-burger-nav-button');
    }

    // ==================== Feedback Locators ====================

    get cookieConsentDialog(): Locator {
        return this.page.getByRole('dialog', {
            name: 'Cookie Consent Banner',
        });
    }

    get searchValidationModal(): Locator {
        // The modal renders as <div role="dialog"> with no accessible name.
        // Disambiguate from the cookie banner via the heading text, and
        // gate on visibility — the storefront ships dual mobile/desktop
        // renderings of the modal (one hidden via CSS) and a plain
        // `.first()` would otherwise resolve to the hidden duplicate.
        return this.page
            .getByRole('dialog')
            .filter({
                hasText: Messages.SEARCH_VALIDATION_MODAL_HEADING,
            })
            .filter({ visible: true });
    }

    get searchValidationModalHeading(): Locator {
        /* eslint-disable playwright/no-nth-methods -- the heading text matches more than one nested element with the same exact textContent (nested wrapper divs); .first() keeps the locator strict-mode safe. */
        return this.searchValidationModal
            .getByText(Messages.SEARCH_VALIDATION_MODAL_HEADING, {
                exact: true,
            })
            .first();
        /* eslint-enable playwright/no-nth-methods */
    }

    searchValidationError(message: string): Locator {
        return this.searchValidationModal
            .getByRole('listitem')
            .filter({ hasText: message });
    }

    get signInDialog(): Locator {
        // The dialog has no role on staging2 — the auth flow renders as
        // sibling `.modal-page` panels; only one is visible at a time.
        // eslint-disable-next-line playwright/no-raw-locators -- `.modal-page` is the storefront's panel-root class; no role.
        return this.page
            .locator('.modal-page')
            .filter({ has: this.signInDialogHeading })
            .filter({ visible: true });
    }

    get signInDialogHeading(): Locator {
        return this.page
            .getByText(Messages.HOME_SIGN_IN_DIALOG_HEADING, {
                exact: true,
            })
            .filter({ visible: true });
    }

    signInMethodButton(method: 'Email' | 'Google' | 'Apple'): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- the storefront's per-method modifier class is the most reliable hook.
        return this.signInDialog.locator(`.login-btn.${method.toLowerCase()}`);
    }

    // ==================== Actions ====================

    /**
     * Navigates to the JustFly home page.
     * @returns Promise that resolves once the document has loaded.
     */
    async open(): Promise<void> {
        await this.page.goto(Routes.HOME);
    }

    /**
     * Dismisses the cookie consent banner if present. The banner intercepts
     * pointer events on the search button, so any test that drives the form
     * via the in-page Search click should run this first.
     */
    async dismissCookieBanner(): Promise<void> {
        const rejectAll = this.cookieConsentDialog.getByRole('button', {
            name: Messages.COOKIE_REJECT_ALL,
        });
        try {
            await rejectAll.click({ timeout: 2000 });
        } catch {
            // Banner not present in this run — fall through.
        }
    }

    /**
     * Switches the storefront currency via the header `Language and
     * Currency` dialog. The Currency row is read-only — currency
     * follows the selected Country / Region — so this action picks
     * the canonical country mapped in `COUNTRY_FOR_CURRENCY`, clicks
     * Save, and waits for the resulting page reload + header refresh.
     *
     * Persists across plain navigation via the `country` / `currency`
     * / `display_currency` cookies on `.justfly.com` (verified live
     * 2026-05-10). For the two-countries-same-currency case (FR / IE
     * both → EUR), drive the dialog inline via the public locators
     * instead of this convenience.
     *
     * @param currency - Target currency code from `SupportedCurrency`.
     * @returns Promise that resolves once the dialog has closed and
     *          the header `currencyDisplay` has updated.
     */
    async selectCurrency(currency: SupportedCurrency): Promise<void> {
        await this.dismissCookieBanner();
        const country = COUNTRY_FOR_CURRENCY[currency];
        await this.currencyDisplay.click();
        await expect(this.currencyDialog).toBeVisible();
        await this.currencyDialogCountryTrigger.click();
        await expect(this.currencyDialogCountryListbox).toBeVisible();
        await this.currencyDialogCountryOption(country).click();
        await expect(this.currencyDialogSaveButton).toBeEnabled();
        await this.currencyDialogSaveButton.click();
        await expect(this.currencyDialog).toBeHidden();
        await expect(this.currencyDisplay).toHaveText(currency);
    }

    /**
     * Submits the search form interactively (clicking the in-page Search
     * button instead of using the deep-link URL). Use this when the test
     * needs the storefront's client-side validation modal to surface;
     * `submitOneWaySearch` / `submitRoundTripSearch` bypass the form via
     * `page.goto` and never trigger that path.
     *
     * @param overrides - Optional clears applied before the click.
     */
    async submitFormAfterClears(overrides?: {
        clearOrigin?: boolean;
        clearDestination?: boolean;
    }): Promise<void> {
        if (overrides?.clearOrigin) {
            await this.originClearButton.click();
        }
        if (overrides?.clearDestination) {
            await this.destinationClearButton.click();
        }
        await this.searchSubmit.click();
    }

    /**
     * Selects an airport in the origin or destination field by clicking
     * the field wrapper, typing the IATA, and clicking the matching
     * autocomplete dropdown option. The display inputs have
     * `pointer-events: none`, so direct `.fill()` / `.click()` on the
     * textbox is rejected. The dropdown click is the only path that
     * produces a stable selection.
     *
     * @param field - 'origin' (Leaving from) or 'destination' (Going to).
     * @param iata - 3-letter IATA code to type and select (e.g. 'YUL').
     */
    async selectAirport(
        field: 'origin' | 'destination',
        iata: string
    ): Promise<void> {
        /* eslint-disable playwright/no-raw-locators */
        const wrapper =
            field === 'origin'
                ? this.page
                      .locator('.search-form-input.origin')
                      .or(this.page.locator('.search-form-input.departure'))
                : this.page.locator('.search-form-input.destination');
        await wrapper.click();

        await this.page.keyboard.type(iata);

        const option = this.page
            .locator('.airport-autocomplete-list-item-airport__name')
            .filter({ hasText: new RegExp(`^${iata}\\s*-`) });
        /* eslint-enable playwright/no-raw-locators */
        // eslint-disable-next-line playwright/no-nth-methods -- mobile and desktop dropdown copies both render this option.
        await option.first().click();
    }

    /**
     * Submits a one-way search via the deep-link URL the home page
     * builds client-side. Bypasses the airport autocomplete so tests
     * stay deterministic.
     *
     * @param inputs - Search parameters (IATA codes, date, pax, cabin).
     */
    async submitOneWaySearch(inputs: JustflySearchInputs): Promise<void> {
        const url = this.buildSearchUrl({ ...inputs, type: 'oneway' });
        await this.page.goto(url);
    }

    /**
     * Submits a round-trip search via the deep-link URL the home page
     * builds client-side.
     *
     * @param inputs - Search parameters; `returnDate` is required.
     */
    async submitRoundTripSearch(
        inputs: JustflySearchInputs & { returnDate: string }
    ): Promise<void> {
        const url = this.buildSearchUrl({ ...inputs, type: 'roundtrip' });
        await this.page.goto(url);
    }

    private buildSearchUrl(
        inputs: JustflySearchInputs & { type: 'oneway' | 'roundtrip' }
    ): string {
        const params = new URLSearchParams({
            type: inputs.type,
            seat_class: this.cabinToSeatClass(inputs.cabin ?? 'Economy'),
            seg0_from: inputs.origin,
            seg0_to: inputs.destination,
            seg0_date: inputs.departureDate,
            num_adults: String(inputs.adults ?? 1),
            num_children: String(inputs.children ?? 0),
            num_infants: String(inputs.infants ?? 0),
            num_infants_lap: '0',
        });

        if (inputs.type === 'roundtrip' && inputs.returnDate) {
            params.set('seg1_date', inputs.returnDate);
            params.set('seg1_from', inputs.destination);
            params.set('seg1_to', inputs.origin);
        }

        return `${Routes.FLIGHT_SEARCH}?${params.toString()}`;
    }

    private cabinToSeatClass(cabin: JustflyCabinClass): string {
        // IATA seat-class codes; matches SEAT_CLASS_MAP in
        // genesis-storefront's FlightSearchProvider.
        const map: Record<JustflyCabinClass, string> = {
            Economy: 'Y',
            'Premium Economy': 'W',
            Business: 'C',
            First: 'F',
        };
        return map[cabin];
    }

    private cabinDisplayName(cabin: JustflyCabinClass): string {
        const map: Record<JustflyCabinClass, Messages> = {
            Economy: Messages.HOME_CABIN_ECONOMY,
            'Premium Economy': Messages.HOME_CABIN_PREMIUM_ECONOMY,
            Business: Messages.HOME_CABIN_BUSINESS,
            First: Messages.HOME_CABIN_FIRST,
        };
        return map[cabin];
    }

    /**
     * Opens the date-range picker, navigates the calendar to the target
     * month if needed, and clicks the day cell matching the supplied
     * ISO-8601 date (`YYYY-MM-DD`).
     *
     * @param iso - ISO date (`YYYY-MM-DD`) to select.
     */
    async selectCalendarDate(iso: string): Promise<void> {
        const target = new Date(`${iso}T00:00:00Z`);
        const monthLabel = formatMonthLabel(target);
        const day = target.getUTCDate();

        for (let step = 0; step < 12; step++) {
            if (await this.dateRangePickerMonth(monthLabel).count()) {
                break;
            }
            await this.dateRangePickerNextMonthButton.click();
        }

        await this.dateRangePickerDay(monthLabel, day).click();
    }

    /**
     * Drives the form-driven trip flow: open the departing date trigger,
     * pick `departureDate`, optionally pick `returnDate`, then commit
     * with `Set dates`.
     *
     * @param departureDate - ISO date for the outbound leg.
     * @param returnDate - Optional ISO date for the return leg.
     */
    async selectTripDates(
        departureDate: string,
        returnDate?: string
    ): Promise<void> {
        // eslint-disable-next-line playwright/no-nth-methods -- the round-trip layout duplicates the trigger across desktop / mobile rendering.
        await this.dateTrigger.first().click();
        await this.selectCalendarDate(departureDate);
        if (returnDate) {
            await this.selectCalendarDate(returnDate);
        }
        await this.dateRangePickerSetDatesButton.click();
    }

    /**
     * Sets the per-pax-type counts via the passengers popover. The
     * storefront enforces dependent-pax constraints (`adults >= children`
     * and `adults >= infants_on_lap`), so the action runs two passes:
     * increments parent-pax types first, then decrements dependents-first.
     *
     * @param counts - Optional partial counts; missing keys leave the
     *                 storefront default in place (`adults: 1`, others 0).
     */
    async setPassengerCounts(counts: JustflyPassengerCounts): Promise<void> {
        await this.passengersInput.click();

        const labelByPaxType: Record<JustflyPaxType, string> = {
            adults: Messages.HOME_PAX_ADULT_LABEL,
            children: Messages.HOME_PAX_CHILD_LABEL,
            infantsOnSeat: Messages.HOME_PAX_INFANT_SEAT_LABEL,
            infantsOnLap: Messages.HOME_PAX_INFANT_LAP_LABEL,
        };

        const increasingOrder: JustflyPaxType[] = [
            'adults',
            'children',
            'infantsOnSeat',
            'infantsOnLap',
        ];
        const decreasingOrder = [...increasingOrder].reverse();

        const adjust = async (
            order: JustflyPaxType[],
            direction: 'increase' | 'decrease'
        ): Promise<void> => {
            for (const paxType of order) {
                const target = counts[paxType];
                if (target === undefined) continue;
                const label = labelByPaxType[paxType];
                const currentText =
                    await this.passengerCount(label).textContent();
                const current = Number(currentText ?? '0');
                const delta = target - current;
                if (direction === 'increase' && delta <= 0) continue;
                if (direction === 'decrease' && delta >= 0) continue;
                const button =
                    delta > 0
                        ? this.passengerPlusButton(label)
                        : this.passengerMinusButton(label);
                for (let i = 0; i < Math.abs(delta); i++) {
                    await button.click();
                }
            }
        };

        await adjust(increasingOrder, 'increase');
        await adjust(decreasingOrder, 'decrease');

        await this.heroHeading.click();
    }

    /**
     * Opens the cabin dropdown and clicks the option matching `cabin`.
     *
     * @param cabin - The cabin class to select.
     */
    async selectCabin(cabin: JustflyCabinClass): Promise<void> {
        await this.cabinDropdownTrigger.click();
        await this.cabinOption(this.cabinDisplayName(cabin)).click();
    }

    /**
     * Submits the search form interactively. Click-driven path that
     * exercises the same form code as a real customer.
     */
    async submitForm(): Promise<void> {
        await this.searchSubmit.click();
    }

    /**
     * Switches the active trip-type tab.
     *
     * @param trip - The trip type to activate.
     */
    async selectTripType(trip: JustflyTripType): Promise<void> {
        const tab =
            trip === 'Round Trip'
                ? this.roundTripTab
                : trip === 'One Way'
                  ? this.oneWayTab
                  : this.multiCityTab;
        await tab.click();
    }

    /**
     * Adds a new (empty) multi-city slice.
     */
    async addMultiCitySlice(): Promise<void> {
        await this.multiCitySliceAddButton.click();
    }

    /**
     * Removes the slice at the given 1-indexed position. Storefront keeps a
     * minimum of 2 slices and only exposes Remove on the last slice when
     * there are 3 or more.
     *
     * @param idx - 1-indexed slice position; must be the current last slice.
     */
    async removeMultiCitySlice(idx: number): Promise<void> {
        if (idx < 3) {
            throw new Error(
                `removeMultiCitySlice requires idx >= 3 (storefront keeps a minimum of 2 slices); got ${idx}`
            );
        }
        await this.multiCitySliceRemoveLink(idx).click();
    }

    /**
     * Selects an airport in a specific multi-city slice's origin or
     * destination field.
     *
     * @param idx - 1-indexed slice position.
     * @param field - 'origin' (Leaving from) or 'destination' (Going to).
     * @param iata - 3-letter IATA code.
     */
    async selectMultiCityAirport(
        idx: number,
        field: 'origin' | 'destination',
        iata: string
    ): Promise<void> {
        const input =
            field === 'origin'
                ? this.multiCitySliceOriginInput(idx)
                : this.multiCitySliceDestinationInput(idx);
        /* eslint-disable playwright/no-raw-locators, playwright/no-nth-methods */
        await input.locator('..').click();
        await this.page.keyboard.type(iata);
        const option = this.page
            .locator('.airport-autocomplete-list-item-airport__name')
            .filter({ hasText: new RegExp(`^${iata}\\s*-`) });
        await option.first().click();
        /* eslint-enable playwright/no-raw-locators, playwright/no-nth-methods */
    }
}

/**
 * Formats a UTC date as `MMM YYYY` to match the react-date-range
 * `.rdrMonthName` rendering (e.g. `Jun 2026`).
 */
function formatMonthLabel(date: Date): string {
    const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
    ];
    return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
