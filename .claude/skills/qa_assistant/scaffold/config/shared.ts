/**
 * Shared configuration for cross-brand services.
 *
 * Flighthub and JustFly run on the same `genesis` backend, but each
 * environment exposes the API behind a brand-prefixed host (FLIGHTHUB_API_URL,
 * JUSTFLY_API_URL). For tests under `tests/shared/` that target the genesis
 * backend, use the active brand's `apiUrl` from `flighthubConfig` / `justflyConfig`
 * — the test runs once per brand project and `process.env.{BRAND}_API_URL`
 * is already loaded by `playwright.config.ts`.
 *
 * This file is the seam for any service that is genuinely brand-agnostic
 * (e.g., a single shared utility microservice, a partner-facing API). Add
 * fields here only when the host is the same for both brands.
 */
export const sharedConfig = {
    /** Optional: shared genesis admin / utility URL if it exists per environment */
    genesisAdminUrl: process.env.GENESIS_ADMIN_URL,
};

/**
 * Respro internal reservations tool — UI cleanup vector for the
 * `@destructive` E2E (no public cancel-booking endpoint in the genesis
 * Storefront API). Cross-brand: a single Respro instance services both
 * flighthub and justfly. Consumed by `pages/shared/respro.page.ts` and
 * the `cancelBookingViaRespro` helper fixture.
 */
// Lazy getters so each field is read from process.env at access time, not at
// module-load time. The runners call loadEnv() AFTER this module is imported,
// so eager initialisation would freeze every field to undefined.
export const resproConfig = {
    get url(): string | undefined {
        return process.env.RESPRO_URL;
    },
    get user(): string | undefined {
        return process.env.RESPRO_USER;
    },
    get password(): string | undefined {
        return process.env.RESPRO_PASS;
    },
};

/**
 * Summit (Momentum OTA-Admin) — internal per-search stats viewer used by
 * `qa-summit-stats` to dump per-content-source outbound fare-fetch calls
 * for a `search_hash`. **Staging only**: production Summit
 * (`https://summit.flighthub.com`) is out of scope per
 * `page_inventory.md § 6`. `SUMMIT_URL` is an optional override; when
 * absent the staging2 host is used.
 *
 * Lazy getters mirror `resproConfig` so `loadEnv()` can populate
 * `process.env` after this module is imported.
 */
export const summitConfig = {
    get url(): string {
        return (
            process.env.SUMMIT_URL ?? 'https://staging2-summit.flighthub.com'
        );
    },
    get user(): string | undefined {
        return process.env.SUMMIT_USER;
    },
    get password(): string | undefined {
        return process.env.SUMMIT_PASS;
    },
};
