import { test as base } from '@playwright/test';
import { ResproPage } from '../../pages/shared/respro.page';

/**
 * Helper fixtures for important, recurring API-driven setup and teardown.
 *
 * IMPORTANT: Most API calls should be made directly with the `apiRequest` fixture
 * inside tests, `beforeEach`, or `afterEach`. Do NOT create a helper fixture for
 * every endpoint. Helper fixtures are reserved for critical, multi-step operations
 * that are reused across many test files and benefit from automatic lifecycle management.
 *
 * WORKFLOW:
 * Playwright's fixture lifecycle guarantees:
 *   1. Setup code (before `use()`) runs BEFORE the test
 *   2. Data passed to `use()` is available in the test via destructuring
 *   3. Teardown code (after `use()`) runs AFTER the test, even on failure
 *
 * WHEN TO CREATE A HELPER FIXTURE:
 * - The same multi-step setup/teardown is copy-pasted across 3+ test files
 * - Complex preconditions require multiple API calls in sequence
 * - Guaranteed teardown is critical (e.g., deleting test users, revoking tokens)
 *
 * WHEN TO USE `apiRequest` FIXTURE DIRECTLY INSTEAD:
 * - One-off API calls in a single test or test file
 * - API assertions (status codes, response validation)
 * - Simple setup in `beforeEach` / teardown in `afterEach`
 * - Calls specific to a single test describe block
 *
 * HOW TO ADD A NEW HELPER FIXTURE:
 * 1. Define the return type (or use a Zod schema's inferred type)
 * 2. Add the type to `HelperFixtures` below
 * 3. Implement the fixture with the setup → use() → teardown pattern
 * 4. It is automatically available in tests (already merged in test-options.ts)
 *
 * NOTE: Helper fixtures use `plain-function.ts` internally (not the `apiRequest`
 * fixture) because fixture-level code needs the raw `request` context. Tests
 * themselves should always use the `apiRequest` fixture from `test-options.ts`.
 *
 * @example
 * ```ts
 * import { apiRequest } from '../api/plain-function';
 *
 * export type HelperFixtures = {
 *     createdBooking: { id: string };
 * };
 *
 * export const test = base.extend<HelperFixtures>({
 *     createdBooking: async ({ request }, use) => {
 *         const { body } = await apiRequest({
 *             request,
 *             method: 'POST',
 *             url: '/api/bookings',
 *             baseUrl: process.env.FLIGHTHUB_API_URL,
 *             headers: process.env.ACCESS_TOKEN,
 *             body: { ... },
 *         });
 *         const booking = body as { id: string };
 *
 *         await use(booking);
 *
 *         await apiRequest({
 *             request,
 *             method: 'DELETE',
 *             url: `/api/bookings/${booking.id}`,
 *             baseUrl: process.env.FLIGHTHUB_API_URL,
 *             headers: process.env.ACCESS_TOKEN,
 *         });
 *     },
 * });
 * ```
 */

export type HelperFixtures = {
    /**
     * Cancels a booking via the Respro UI ("Abort Booking" → proceed) in
     * a fresh `BrowserContext`. Cleanup vector for the `@destructive`
     * Flighthub E2E.
     *
     * @param bookingId - Dashless numeric Respro booking id.
     */
    cancelBookingViaRespro: (bookingId: string) => Promise<void>;
};

export const test = base.extend<HelperFixtures>({
    cancelBookingViaRespro: async ({ browser }, use) => {
        await use(async (bookingId: string) => {
            const context = await browser.newContext({
                storageState: undefined,
            });
            try {
                const page = await context.newPage();
                const respro = new ResproPage(page);
                await respro.login();
                await respro.openBooking(bookingId);
                await respro.abortAndConfirm();
            } finally {
                await context.close();
            }
        });
    },
});
