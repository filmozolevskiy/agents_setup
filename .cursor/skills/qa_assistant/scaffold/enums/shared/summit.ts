/**
 * Summit (Momentum OTA-Admin) — UI routes and verified selector / label
 * strings for the per-search stats page on staging.
 *
 * Verified against `https://staging2-summit.flighthub.com` on 2026-05-27
 * via the throwaway logged-in inspector
 * (`runners/_probes/summit-inspect.ts`). Production Summit
 * (`https://summit.flighthub.com`) is out of scope — staging only.
 */

/** Summit UI route paths (relative to SUMMIT_URL). */
export enum Routes {
    LOGIN = '/',
    SEARCH_INFO = '/flight-search/info',
}

/**
 * Summit UI selectors used by `SummitStatsPage`. The DOM uses bare CSS
 * ids and class selectors throughout (no `data-*` test hooks), so these
 * constants are the single source of truth for selector rot.
 */
export enum Selectors {
    /** Login form input — the field is `name="email"`, id `#email`. */
    LOGIN_USERNAME = '#email',
    LOGIN_PASSWORD = '#password',
    LOGIN_SUBMIT = '#process-login',
    /** Wrapper for all per-search content (login redirect lands elsewhere). */
    STATS_CONTAINER = '#flightSearchStats',
    /**
     * Top-level summary block. Present only while the search is still in
     * Summit's in-memory store (~20 min after run). Absent → either the
     * search expired, or the hash never existed.
     */
    STATS_SUMMARY = '#flightSearchStats fieldset.stats',
    /** Extra timing / counter rollups under the summary. */
    STATS_EXTRA = '#flightSearchStats fieldset.extraStats',
    /**
     * `Search urls` fieldset — transposed table where columns are URL ids
     * (`1`, `2`, …) and rows are attribute names (`api url`, `gds`,
     * `content_source`, `runtime`, `received packages`, …). One column
     * per outbound fare-fetch call.
     */
    URL_STATS_TABLE = '#flightSearchStats fieldset#urlStats table',
}

/**
 * Text strings the page renders when the keyed search is no longer in
 * Summit's in-memory store. The keyed page wraps the message in a
 * `<fieldset><legend>Error</legend><div>Search not found</div></fieldset>`
 * block, so the bare substring is the most reliable signal — older
 * legacy docs cited "Error: Search not found", but the rendered text is
 * just "Search not found".
 *
 * `SummitStatsPage.assertSearchFound()` raises a typed error
 * (`code: 'SUMMIT_SEARCH_NOT_FOUND'`) on either the text match or the
 * absence of `fieldset.stats`, so callers can distinguish expiry from
 * selector rot.
 */
export enum Messages {
    SEARCH_NOT_FOUND = 'Search not found',
}
