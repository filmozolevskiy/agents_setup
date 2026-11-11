import { Locator, Page } from '@playwright/test';
import { resproConfig } from '../../config/shared';
import { AbortReason, Messages, Routes } from '../../enums/shared/respro';

/**
 * Page object for the **Respro** internal reservations / fulfillment tool.
 *
 * Cleanup vector for the `@destructive` Flighthub E2E — the genesis
 * Storefront API exposes no public cancel-booking endpoint, so the team
 * aborts via this internal UI. Cross-brand: a single Respro instance
 * services bookings from both flighthub and justfly.
 */
export class ResproPage {
    constructor(private readonly page: Page) {}

    // ==================== Locators ====================

    // The ResPro /login page does not render <label>, placeholder, or
    // aria-label attributes on its inputs (verified via DOM probe), so the
    // getByLabel(...) approach times out at 30s. Anchor on the stable
    // name="..."/id="..." attributes instead. Submit is an <input type="submit">
    // (not a <button>), so getByRole('button', { name: 'Sign In' }) also
    // misses; the id is "process-login".
    get usernameInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- no label / aria / placeholder on this input; name= is the only stable anchor.
        return this.page.locator('input[name="username"]');
    }

    get passwordInput(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- no label / aria / placeholder on this input; name= is the only stable anchor.
        return this.page.locator('input[name="password"]');
    }

    get signInButton(): Locator {
        // eslint-disable-next-line playwright/no-raw-locators -- submit is <input type="submit">, not <button>, so getByRole misses.
        return this.page.locator('#process-login');
    }

    get abortBookingLink(): Locator {
        return this.page.getByText(Messages.ABORT_BOOKING, {
            exact: true,
        });
    }

    get abortDialog(): Locator {
        return this.page
            .getByRole('dialog')
            .filter({ hasText: Messages.ABORT_BOOKING });
    }

    get abortDialogReasonSelect(): Locator {
        return this.abortDialog.getByRole('combobox');
    }

    get abortDialogSubmit(): Locator {
        // The submit renders as a non-semantic element with cursor:pointer
        // (not a `<button>`), so getByRole('button') misses it. Scoping to
        // the dialog disambiguates from the trigger link with the same
        // text in the booking sidebar.
        return this.abortDialog.getByText(Messages.ABORT_BOOKING, {
            exact: true,
        });
    }

    // ==================== Actions ====================

    /**
     * Logs into Respro with the credentials from `resproConfig`. Caller
     * is responsible for asserting any post-login state.
     *
     * @returns Promise that resolves once the sign-in click has navigated.
     */
    async login(): Promise<void> {
        await this.page.goto(`${resproConfig.url ?? ''}${Routes.LOGIN}`);
        await this.usernameInput.fill(resproConfig.user ?? '');
        await this.passwordInput.fill(resproConfig.password ?? '');
        await this.signInButton.click();
    }

    /**
     * Navigates to the booking detail page. Respro silently redirects to
     * `/home/index` when the id is unknown, so callers should validate
     * the resulting URL before continuing.
     *
     * @param bookingId - Numeric booking id (dashless — Respro's URL form).
     * @returns Promise that resolves once the booking page has loaded.
     */
    async openBooking(bookingId: string): Promise<void> {
        await this.page.goto(
            `${resproConfig.url ?? ''}${Routes.BOOKING_INDEX}/${bookingId}`
        );
    }

    /**
     * Clicks the **Abort Booking** sidebar link, picks an abort reason in
     * the resulting modal dialog, and submits. Verified end-to-end against
     * a real test booking on staging2 (Trello e3Uq1uUp): the action drops
     * the booking's pending Ticket / CC tasks and writes
     * "Aborted by: <user>" into the audit log. Booking status itself does
     * NOT immediately flip to CLOSED — that is operator-driven and out of
     * scope for QA cleanup.
     *
     * @param reason - Abort reason posted to the audit log; defaults to
     *                 `TEST` so analytics can filter QA traffic.
     * @returns Promise that resolves once the dialog submit has been clicked.
     */
    async abortAndConfirm(
        reason: AbortReason = AbortReason.TEST
    ): Promise<void> {
        await this.abortBookingLink.click();
        await this.abortDialog.waitFor({ state: 'visible' });
        await this.abortDialogReasonSelect.selectOption(reason);
        await this.abortDialogSubmit.click();
    }
}
