/**
 * Cross-suite timeout budgets (milliseconds) used by tests, page-object
 * actions, and helper fixtures. Centralised here so spec / POM code
 * stays free of bare numeric literals (constitution: "No Magic Numbers").
 *
 * Numeric enum — TypeScript permits literal numeric members and the
 * resulting type is `Timeouts`, so callers like
 * `{ timeout: Timeouts.LIVE_GDS_NAV_MS }` compose naturally with
 * Playwright's `{ timeout: number }` option bag.
 */
export enum Timeouts {
    LIVE_GDS_NAV_MS = 60_000,
    BOOKING_CONFIRMATION_MS = 120_000,
    /**
     * Per-test budget for the live checkout-flow specs that walk
     * search → select → checkout (no Confirm and Book). Covers the
     * GDS wait + post-Select interstitial sequence and a buffer.
     */
    CHECKOUT_FLOW_MS = 180_000,
    /* eslint-disable @typescript-eslint/no-duplicate-enum-values --
       CHECKOUT_FORM_COVERAGE_MS and DESTRUCTIVE_E2E_MS coincide by
       value but represent distinct semantic surfaces (form coverage
       vs the full destructive happy path). Keeping two members lets
       call sites communicate intent and lets the budgets diverge
       independently in the future. */
    /**
     * Per-test budget for the multi-pax / insurance / cart coverage
     * specs that exercise more of the checkout surface than
     * CHECKOUT_FLOW_MS but stop short of the destructive Confirm and
     * Book click.
     */
    CHECKOUT_FORM_COVERAGE_MS = 240_000,
    DESTRUCTIVE_E2E_MS = 240_000,
    /* eslint-enable @typescript-eslint/no-duplicate-enum-values */
    // Grace window for probing the Google Places billing-address
    // autocomplete dropdown (`.pac-item` rows). The Places API key
    // returns suggestions intermittently in headless runs; tests
    // skip with the OZgRaA1S FIXME path when no row materialises
    // within this window.
    GOOGLE_PLACES_PROBE_MS = 3_000,
    /**
     * Per-attempt budget for the "Continue to payment" click → payment
     * section expansion side effect (the Continue button unmounts and
     * the card-details form gets layout). The happy path resolves in
     * ~500ms on staging2; 5s leaves slack for a slow React render
     * without dragging the outer `expect.toPass` retry loop.
     */
    PAYMENT_SECTION_EXPAND_MS = 5_000,
}
