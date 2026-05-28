import type { Page } from '@playwright/test';
import { summitConfig } from '../../config/shared';
import { Messages, Routes, Selectors } from '../../enums/shared/summit';

/**
 * One outbound supplier fare-fetch call for a single `search_hash`. The
 * Summit `#urlStats` table renders these as **columns** of a transposed
 * table (rows = attribute names, columns = url ids), so this object is
 * built by collecting one cell per `<th>` row label.
 *
 * `attributes` holds the verbatim `{ label: value }` map so the parser
 * stays forward-compatible when Summit adds new rows (e.g. a new
 * experiment param). The named fields are convenience plucks pulled from
 * the same map; they may be `null` when Summit omits the row.
 */
export interface UrlStatRecord {
    /** 1-based column index in the urlStats table. */
    url_id: number;
    /** `api url` cell — the outbound URL to the supplier; null on rows that lack the anchor. */
    api_url: string | null;
    /** `content_source` cell — the canonical supplier slug (amadeus, farelogix, …). */
    content_source: string | null;
    /** `gds` cell — display name, e.g. "Amadeus". */
    gds: string | null;
    /** `office_id` / `office_currency` — supplier-side office key. */
    office_id: string | null;
    office_currency: string | null;
    /** `runtime` — supplier roundtrip time, verbatim string (e.g. "1.234"). */
    runtime: string | null;
    /** Packages received / priced / total. */
    received_packages: string | null;
    priced_packages: string | null;
    total_packages: string | null;
    /** `type` (e.g. Hardcoded), `backend` (e.g. Api), and `no stats` flag. */
    type: string | null;
    backend: string | null;
    no_stats: string | null;
    /** Block-and-drop counters from the package classifier. */
    blocked_pricing: string | null;
    blocked_supplier: string | null;
    /** All `<th>label</th>` → `<td>value</td>` rows verbatim. */
    attributes: Record<string, string>;
}

/**
 * Search-level Stats block (the `<fieldset class="stats">` dl head + the
 * three column dls). `dl` head holds the navigation links (Web link, Api
 * link, Debug log); the column dls hold counters and timers.
 */
export interface StatsSummary {
    /** Verbatim `<dt>label</dt> <dd>value</dd>` pairs (text only). */
    fields: Record<string, string>;
    /** Anchor URLs harvested from the same dls. Keys are dt labels. */
    links: Record<string, string>;
}

/**
 * Page object for the Summit per-search stats page on staging
 * (`/flight-search/info/{search_hash}`). Captures three parsed surfaces:
 *
 *  - `parseSummary()`        — `fieldset.stats` (Search id / Web link / Api link /
 *                              Debug log + Started / Completed / Packages count /
 *                              Runtime / Backend / Expire at / Started at).
 *  - `parseExtraStats()`     — `fieldset.extraStats` (gds_urls_count,
 *                              gds_timeouts_count, gds_errors_count, timer_*).
 *  - `parseUrlStats()`       — `fieldset#urlStats table` flipped from
 *                              column-per-url to one `UrlStatRecord` per
 *                              outbound supplier call.
 *
 * Throws `SUMMIT_SEARCH_NOT_FOUND` when the page renders the
 * "Error: Search not found" template — that means the hash expired
 * (Summit retains stats for ~20 min) or never existed; callers should
 * drive a fresh search and retry rather than treat the empty result as
 * a real `0 urls` answer.
 */
export class SummitStatsPage {
    constructor(private readonly page: Page) {}

    /**
     * Logs into Summit at `SUMMIT_URL`. Idempotent: if a prior session
     * cookie is still valid the submit click no-ops and we land on the
     * post-login dashboard. Caller is responsible for sequencing this
     * before `openSearch()`.
     */
    async login(): Promise<void> {
        if (!summitConfig.user || !summitConfig.password) {
            throw new Error(
                'SUMMIT_USER / SUMMIT_PASS are not set. Populate .env at the repo root (copy .env.example).'
            );
        }
        await this.page.goto(`${summitConfig.url}${Routes.LOGIN}`);
        await this.page
            .locator(Selectors.LOGIN_USERNAME)
            .fill(summitConfig.user);
        await this.page
            .locator(Selectors.LOGIN_PASSWORD)
            .fill(summitConfig.password);
        // Click the submit and wait for the navigation it triggers in
        // one race-free step. The post-login landing path depends on
        // the user's role (dashboard vs admin home), so we wait on the
        // navigation event itself rather than a specific URL pattern.
        await Promise.all([
            this.page.waitForLoadState('domcontentloaded'),
            this.page.locator(Selectors.LOGIN_SUBMIT).click(),
        ]);
    }

    /**
     * Navigates directly to the keyed stats URL. The `#searchIdForm`
     * lookup on the dashboard just redirects to the same path, so we
     * skip it entirely.
     */
    async openSearch(searchHash: string): Promise<void> {
        await this.page.goto(
            `${summitConfig.url}${Routes.SEARCH_INFO}/${searchHash}`,
            { waitUntil: 'domcontentloaded' }
        );
        // Both healthy and "Search not found" templates render the
        // `#flightSearchStats` wrapper; wait on it so isSearchFound()
        // doesn't race the initial paint.
        await this.page
            .locator(Selectors.STATS_CONTAINER)
            .first()
            .waitFor({ state: 'attached', timeout: 15000 });
    }

    /**
     * Returns the search-level Stats fieldset. The `links` map carries
     * the anchor URLs harvested from the same dls (Web link, Api link,
     * Debug log) so callers can cite them as Proof.
     *
     * Throws `SUMMIT_SEARCH_NOT_FOUND` when the page text reports the
     * keyed hash is expired or unknown.
     */
    async parseSummary(): Promise<StatsSummary> {
        await this.assertSearchFound();
        return this.page.locator(Selectors.STATS_SUMMARY).evaluate((root) => {
            const fields: Record<string, string> = {};
            const links: Record<string, string> = {};
            for (const dl of Array.from(root.querySelectorAll('dl'))) {
                const dts = Array.from(dl.querySelectorAll('dt'));
                const dds = Array.from(dl.querySelectorAll('dd'));
                const n = Math.min(dts.length, dds.length);
                for (let i = 0; i < n; i++) {
                    const label = (dts[i].textContent ?? '').trim();
                    const dd = dds[i];
                    const text = (dd.textContent ?? '').trim();
                    if (!label) continue;
                    fields[label] = text;
                    const anchor = dd.querySelector('a[href]');
                    if (anchor) {
                        links[label] = (anchor as HTMLAnchorElement).href;
                    }
                }
            }
            return { fields, links };
        });
    }

    /**
     * Returns the Extra Stats fieldset as a flat `{label: value}` map.
     * Empty object if Summit omits the fieldset (it is conditional on
     * which search backend ran).
     */
    async parseExtraStats(): Promise<Record<string, string>> {
        const locator = this.page.locator(Selectors.STATS_EXTRA);
        if ((await locator.count()) === 0) return {};
        return locator.evaluate((root) => {
            const out: Record<string, string> = {};
            for (const tr of Array.from(root.querySelectorAll('tr'))) {
                const th = tr.querySelector('th');
                const td = tr.querySelector('td');
                if (!th || !td) continue;
                const label = (th.textContent ?? '').trim();
                if (!label) continue;
                out[label] = (td.textContent ?? '').trim();
            }
            return out;
        });
    }

    /**
     * Parses `fieldset#urlStats table` into one `UrlStatRecord` per URL
     * column. The Summit table is transposed (rows = attribute names,
     * columns = url ids), so this method flips it back to the natural
     * "one record per outbound call" shape callers expect.
     *
     * Empty array when the search has no outbound calls (e.g. cached
     * replay); throws `SUMMIT_SEARCH_NOT_FOUND` when the hash is gone.
     */
    async parseUrlStats(): Promise<UrlStatRecord[]> {
        await this.assertSearchFound();
        const table = this.page.locator(Selectors.URL_STATS_TABLE);
        if ((await table.count()) === 0) return [];

        return table.evaluate((root): UrlStatRecord[] => {
            const tableEl = root as HTMLTableElement;
            const headerCells = Array.from(
                tableEl.querySelectorAll('thead tr th')
            );
            // First header cell is the literal label "Url id"; the rest
            // are 1, 2, 3 … one per outbound call.
            const urlIds = headerCells
                .slice(1)
                .map((th) => Number((th.textContent ?? '').trim()))
                .filter((n) => Number.isFinite(n) && n > 0);

            // Build a per-column attributes map by walking each body row.
            const perColumn: Map<
                number,
                {
                    attrs: Record<string, string>;
                    anchors: Record<string, string>;
                }
            > = new Map();
            for (const id of urlIds) {
                perColumn.set(id, { attrs: {}, anchors: {} });
            }

            for (const tr of Array.from(tableEl.querySelectorAll('tbody tr'))) {
                const th = tr.querySelector('th');
                const tds = Array.from(tr.querySelectorAll('td'));
                const label = (th?.textContent ?? '').trim();
                if (!label) continue;
                for (let i = 0; i < tds.length && i < urlIds.length; i++) {
                    const id = urlIds[i];
                    const col = perColumn.get(id);
                    if (!col) continue;
                    const td = tds[i];
                    const value = (td.textContent ?? '').trim();
                    col.attrs[label] = value;
                    const anchor = td.querySelector('a[href]');
                    if (anchor) {
                        col.anchors[label] = (anchor as HTMLAnchorElement).href;
                    }
                }
            }

            const records: UrlStatRecord[] = [];
            for (const id of urlIds) {
                const col = perColumn.get(id);
                if (!col) continue;
                const a = col.attrs;
                // Prefer the anchor href for `api url`; the text-only
                // cell just says "Link".
                const apiUrl = col.anchors['api url'] ?? null;
                records.push({
                    url_id: id,
                    api_url: apiUrl,
                    content_source: a['content_source'] ?? null,
                    gds: a['gds'] ?? null,
                    office_id: a['office_id'] ?? null,
                    office_currency: a['office_currency'] ?? null,
                    runtime: a['runtime'] ?? null,
                    received_packages: a['received packages'] ?? null,
                    priced_packages: a['priced packages'] ?? null,
                    total_packages: a['total packages'] ?? null,
                    type: a['type'] ?? null,
                    backend: a['backend'] ?? null,
                    no_stats: a['no stats'] ?? null,
                    blocked_pricing: a['blocked.pricing'] ?? null,
                    blocked_supplier: a['blocked.supplier'] ?? null,
                    attributes: a,
                });
            }
            return records;
        });
    }

    /**
     * Returns true when Summit reports the keyed hash is expired or
     * unknown. Two signals (either is sufficient):
     *
     *  1. The page text contains "Search not found" — the keyed page
     *     wraps this in a `<fieldset><legend>Error</legend>…</fieldset>`
     *     block whenever the search is gone.
     *  2. The `fieldset.stats` summary block is absent — a healthy keyed
     *     page always renders it.
     */
    async isSearchFound(): Promise<boolean> {
        const body = (await this.page.locator('body').textContent()) ?? '';
        if (body.includes(Messages.SEARCH_NOT_FOUND)) return false;
        const count = await this.page.locator(Selectors.STATS_SUMMARY).count();
        return count > 0;
    }

    /**
     * Throws a typed `SUMMIT_SEARCH_NOT_FOUND` error when
     * `isSearchFound()` reports false. Used as the guard at the top of
     * the parse methods so they fail fast (and predictably) instead of
     * timing out on absent selectors.
     */
    private async assertSearchFound(): Promise<void> {
        if (await this.isSearchFound()) return;
        const err = new Error(
            `Summit reports "${Messages.SEARCH_NOT_FOUND}" — the search hash is expired (~20 min retention) or never existed.`
        );
        (err as Error & { code?: string }).code = 'SUMMIT_SEARCH_NOT_FOUND';
        throw err;
    }
}
