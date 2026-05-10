/**
 * Shared helper that drives the genesis Storefront search pipeline far enough
 * to produce a real `(searchId, packageId)` pair, which is the pre-condition
 * for the `check-availability` and `get-tax-breakdown` happy-path API tests.
 *
 * The genesis search pipeline is asynchronous: an immediate
 * `search-result-fetch` after `search-init` typically returns
 * `{completed: false, packages: []}`. This helper polls until the search
 * either completes or surfaces at least one package — whichever comes first
 * — and returns the first package id it sees. The `tests/shared/api/*`
 * happy paths consume the pair as opaque path parameters; the per-package
 * shape is already validated by `PackageSchema` in `searchResultFetch.spec.ts`,
 * so this helper deliberately does not re-parse it.
 *
 * Why a helper (not a fixture):
 *   1. Only two specs need it (`check-availability`, `get-tax-breakdown`),
 *      so the helper-vs-fixture rule of thumb (3+ specs ⇒ promote) does
 *      not apply.
 *   2. The pair is request-scoped and read-only — there is no setup
 *      side effect to roll back, so a worker-scoped fixture would just
 *      add lifecycle noise.
 *   3. Promotion to a fixture is cheap if a third consumer appears.
 *
 * Cross-brand parity: the helper does not pin a brand. Callers pass
 * `apiUrl` (typically `flighthubConfig.apiUrl ?? justflyConfig.apiUrl!`,
 * matching the shared spec convention). The default search params target
 * a YUL→JFK oneway eight months out, which has consistently returned
 * results on both staging2 brands during recon.
 */

import { ApiRequestFn } from '../../fixtures/api/api-types';
import { ApiEndpoints } from '../../enums/shared/genesis';
import {
    SearchInitResponse,
    SearchInitResponseSchema,
    SearchResultFetchResponse,
    SearchResultFetchResponseSchema,
} from '../../fixtures/api/schemas/shared/searchSchema';

export type SeededSearchPair = {
    searchId: string;
    packageId: string;
};

export type SeedSearchPairOptions = {
    apiRequest: ApiRequestFn;
    apiUrl: string;
    /**
     * Override the default search-init query string. When omitted the helper
     * uses a YUL→JFK oneway eight months out (1 adult, Economy) — a route
     * that has been stable on both Flighthub and JustFly staging2 during
     * recon. Set this when a spec needs a specific shape (multi-pax,
     * roundtrip, transborder) the default does not exercise.
     */
    searchParams?: URLSearchParams;
    /**
     * Override the `surfer_id` query param on `search-init` so the genesis
     * throttler treats concurrent runs as independent searches. Defaults
     * to `"pwt_search_setup_<random>"`. Ignored when `searchParams` is
     * provided (assume the caller has already set their own).
     */
    surferId?: string;
    /** Total polling budget in ms. Defaults to 30s. */
    pollTimeoutMs?: number;
};

const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVALS_MS = [500, 1_000, 2_000] as const;

function buildDefaultSearchParams(surferId: string): URLSearchParams {
    const eightMonthsOut = new Date();
    eightMonthsOut.setMonth(eightMonthsOut.getMonth() + 8);
    const yyyy = eightMonthsOut.getFullYear();
    const mm = String(eightMonthsOut.getMonth() + 1).padStart(2, '0');
    const dd = String(eightMonthsOut.getDate()).padStart(2, '0');

    return new URLSearchParams({
        num_adults: '1',
        num_children: '0',
        num_infants: '0',
        num_infants_lap: '0',
        seat_class: 'Economy',
        seg0_date: `${yyyy}-${mm}-${dd}`,
        seg0_from: 'YUL',
        seg0_to: 'JFK',
        type: 'oneway',
        surfer_id: surferId,
    });
}

/**
 * Drive `search-init` → polled `search-result-fetch` until at least one
 * package surfaces, and return the first `(searchId, packageId)` pair.
 *
 * @throws If `search-init` does not return a non-null `search_id`, if the
 *   poll budget is exhausted before any package is returned, or if the
 *   completed search ends up with `packages: []` (empty results — pick a
 *   different OD and retry).
 */
export async function seedSearchPair(
    options: SeedSearchPairOptions
): Promise<SeededSearchPair> {
    const {
        apiRequest,
        apiUrl,
        searchParams,
        surferId = `pwt_search_setup_${Math.random().toString(36).slice(2, 10)}`,
        pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    } = options;

    const params = searchParams ?? buildDefaultSearchParams(surferId);

    const init = await apiRequest<SearchInitResponse>({
        method: 'GET',
        url: `${ApiEndpoints.SEARCH_INIT}?${params.toString()}`,
        baseUrl: apiUrl,
    });
    if (init.status !== 200) {
        throw new Error(
            `seedSearchPair: search-init returned status ${init.status} (expected 200)`
        );
    }
    const initParsed = SearchInitResponseSchema.parse(init.body);
    if (initParsed.search_id === null) {
        throw new Error(
            'seedSearchPair: search-init returned search_id = null (live soft-fail; verify search params)'
        );
    }
    const searchId = initParsed.search_id;

    const deadline = Date.now() + pollTimeoutMs;
    let attempt = 0;
    let lastFetch: SearchResultFetchResponse | undefined;
    while (Date.now() < deadline) {
        const fetched = await apiRequest<SearchResultFetchResponse>({
            method: 'GET',
            url: `${ApiEndpoints.SEARCH_RESULT_FETCH}/${searchId}`,
            baseUrl: apiUrl,
        });
        if (fetched.status !== 200) {
            throw new Error(
                `seedSearchPair: search-result-fetch returned status ${fetched.status} on attempt ${attempt + 1} (expected 200)`
            );
        }
        const parsed = SearchResultFetchResponseSchema.parse(fetched.body);
        lastFetch = parsed;

        if (!Array.isArray(parsed.packages) && parsed.paged_package_count > 0) {
            const pkgIds = Object.keys(parsed.packages);
            if (pkgIds.length > 0) {
                return { searchId, packageId: pkgIds[0] };
            }
        }

        if (parsed.completed) {
            break;
        }

        const interval =
            POLL_INTERVALS_MS[Math.min(attempt, POLL_INTERVALS_MS.length - 1)];
        await new Promise((r) => setTimeout(r, interval));
        attempt += 1;
    }

    throw new Error(
        `seedSearchPair: poll budget exhausted (${pollTimeoutMs}ms) without surfacing a package; ` +
            `last completed=${lastFetch?.completed ?? 'unknown'}, ` +
            `all_package_count=${lastFetch?.all_package_count ?? 'unknown'}, ` +
            `searchId=${searchId}`
    );
}
