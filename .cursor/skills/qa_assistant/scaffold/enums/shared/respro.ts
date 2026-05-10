/**
 * Respro internal reservations tool — UI routes and verified message strings.
 *
 * Captured via `playwright-cli` exploration on 2026-05-04 against
 * `https://reservations.voyagesalacarte.ca`. Used by `pages/shared/respro.page.ts`
 * and the `cancelBookingViaRespro` helper fixture.
 */

/** Respro UI route paths (relative to RESPRO_URL). */
export enum Routes {
    LOGIN = '/login',
    HOME = '/home/index',
    BOOKING_INDEX = '/booking/index',
}

/**
 * Respro UI text strings used by selectors. Verified by aborting a real
 * test booking on staging2 (Trello e3Uq1uUp); only the booking-detail
 * status text remains environment-dependent and is not asserted here.
 */
export enum Messages {
    LOGIN_USERNAME_LABEL = 'Username',
    LOGIN_PASSWORD_LABEL = 'Password',
    SIGN_IN_BUTTON = 'Sign In',
    // The same "Abort Booking" string is reused for the sidebar link, the
    // dialog title, and the dialog submit; one constant keeps callers
    // honest if Respro ever splits them.
    ABORT_BOOKING = 'Abort Booking',
    ABORT_DIALOG_REASON_LABEL = 'Reason:',
}

/**
 * Reasons surfaced by the Respro abort-booking dialog. The default for
 * @destructive QA cleanup is `TEST` so production analytics can filter
 * test traffic.
 */
export enum AbortReason {
    CUSTOMER_REQUEST = 'Customer Request',
    CC_DECLINE = 'CC Decline',
    FARE_INVALID = 'Fare Invalid',
    FRAUD = 'Fraud',
    MULTI_TICKET_BOOKING_FAILED = 'Multi-Ticket Booking Failed',
    UNCONFIRMED_SEGMENTS = 'Unconfirmed Segments',
    TEST = 'Test',
    OTHER = 'Other',
}
