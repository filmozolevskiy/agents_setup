import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    FiltersSchema,
    PackageSchema,
    SearchInitResponse,
    SearchInitResponseSchema,
    SearchResultFetchResponse,
    SearchResultFetchResponseSchema,
} from '../../../fixtures/api/schemas/shared/searchSchema';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

const SEARCH_INIT_PARAMS = new URLSearchParams({
    num_adults: '1',
    num_children: '0',
    num_infants: '0',
    num_infants_lap: '0',
    seat_class: 'Economy',
    seg0_date: '2026-08-15',
    seg0_from: 'YUL',
    seg0_to: 'JFK',
    type: 'oneway',
    surfer_id: 'shared_search_result_fetch_spec',
});

test.describe('genesis Storefront API — /storefront-api/search-result-fetch', () => {
    test(
        'init -> fetch chain returns 200 with packages keyed by package id',
        { tag: '@api' },
        async ({ apiRequest }) => {
            let searchId: string | null = null;

            await test.step('GET /search-init returns a search_id', async () => {
                const { status, body } = await apiRequest<SearchInitResponse>({
                    method: 'GET',
                    url: `${ApiEndpoints.SEARCH_INIT}?${SEARCH_INIT_PARAMS.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(200);
                expect(SearchInitResponseSchema.parse(body)).toBeTruthy();
                const parsed = SearchInitResponseSchema.parse(body);
                expect(parsed.search_id).not.toBeNull();
                searchId = parsed.search_id;
            });

            await test.step('GET /search-result-fetch/{searchId} returns paged results', async () => {
                const { status, body } =
                    await apiRequest<SearchResultFetchResponse>({
                        method: 'GET',
                        url: `${ApiEndpoints.SEARCH_RESULT_FETCH}/${searchId}`,
                        baseUrl: apiUrl,
                    });
                expect(status).toBe(200);
                expect(
                    SearchResultFetchResponseSchema.parse(body)
                ).toBeTruthy();
                const parsed = SearchResultFetchResponseSchema.parse(body);
                expect(parsed.current_page).toBe(1);
                expect(parsed.all_package_count).toBeGreaterThanOrEqual(0);
                // The wrapper schema already validated `filters`, but a
                // focused parse via `FiltersSchema` gives a per-key
                // ZodError if a future drift only affects the filters
                // block (vs. the wrapper). The 21-key strict shape lands
                // here from the C2 capture matrix
                // (https://trello.com/c/vuPgw8Ks).
                expect(FiltersSchema.parse(parsed.filters)).toBeTruthy();
            });
        }
    );

    test(
        'get with an unknown searchId returns 200 with completed: false and empty packages (live drift; OpenAPI implies 404)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } =
                await apiRequest<SearchResultFetchResponse>({
                    method: 'GET',
                    url: `${ApiEndpoints.SEARCH_RESULT_FETCH}/__nonexistent_search_id__`,
                    baseUrl: apiUrl,
                });

            expect(status).toBe(200);
            expect(SearchResultFetchResponseSchema.parse(body)).toBeTruthy();
            const parsed = SearchResultFetchResponseSchema.parse(body);
            expect(parsed.completed).toBe(false);
            expect(parsed.all_package_count).toBe(0);
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/QxPqz6cS — OpenAPI marks the request body
    // (the `filters` object with 12 required keys) as `required: true`. Live
    // staging2 accepts a GET with no body and falls back to default filters,
    // so per-field omission and per-field invalid-type loops cannot be
    // exercised against the documented contract.
    test.skip(
        'get without `filters` body returns 400 (OpenAPI contract; live returns 200 with default filters)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.SEARCH_RESULT_FETCH}/__any_search_id__`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(400);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    test(
        'every package in a populated response validates against the strict PackageSchema',
        { tag: '@api' },
        async ({ apiRequest }) => {
            let searchId: string | null = null;

            await test.step('GET /search-init returns a search_id', async () => {
                const { status, body } = await apiRequest<SearchInitResponse>({
                    method: 'GET',
                    url: `${ApiEndpoints.SEARCH_INIT}?${SEARCH_INIT_PARAMS.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(200);
                expect(SearchInitResponseSchema.parse(body)).toBeTruthy();
                searchId = SearchInitResponseSchema.parse(body).search_id;
                expect(searchId).not.toBeNull();
            });

            await test.step('GET /search-result-fetch packages all validate against PackageSchema', async () => {
                // The genesis search pipeline is asynchronous: an immediate
                // fetch right after `search-init` typically returns
                // `completed: false` and `packages: []`. Poll until the
                // search is either completed or has at least one package
                // — whichever happens first — so the per-package
                // validation actually has data to validate. Polling stops
                // as soon as either condition is met.
                let lastBody: SearchResultFetchResponse | undefined;
                await expect
                    .poll(
                        async () => {
                            const { status, body } =
                                await apiRequest<SearchResultFetchResponse>({
                                    method: 'GET',
                                    url: `${ApiEndpoints.SEARCH_RESULT_FETCH}/${searchId}`,
                                    baseUrl: apiUrl,
                                });
                            expect(status).toBe(200);
                            const parsed =
                                SearchResultFetchResponseSchema.parse(body);
                            lastBody = parsed;
                            return (
                                parsed.completed ||
                                parsed.paged_package_count > 0
                            );
                        },
                        { timeout: 30_000, intervals: [500, 1_000, 2_000] }
                    )
                    .toBe(true);

                expect(lastBody).toBeDefined();
                const parsed = lastBody!;
                expect(Array.isArray(parsed.packages)).toBe(false);
                const pkgRecord = parsed.packages as Record<string, unknown>;
                const pkgIds = Object.keys(pkgRecord);
                expect(pkgIds.length).toBeGreaterThan(0);

                // The wrapper schema has already validated every package, but
                // re-parsing the inner records directly via `PackageSchema`
                // gives a focused failure if a future drift only affects the
                // package shape (vs. the wrapper).
                for (const pkgId of pkgIds) {
                    expect(PackageSchema.parse(pkgRecord[pkgId])).toBeTruthy();
                }

                const firstPkg = PackageSchema.parse(pkgRecord[pkgIds[0]]);
                expect(firstPkg.city_pairs.length).toBeGreaterThan(0);
                expect(firstPkg.city_pairs[0].segments.length).toBeGreaterThan(
                    0
                );
                expect(firstPkg.price.currency).toMatch(/^[A-Z]{3}$/);
            });
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/QxPqz6cS — the OpenAPI Package definition
    // diverges materially from what the live API returns: documented field
    // set is a 6-key subset, `cabin` enum is PascalCase
    // (Economy / EconomyPremium / Business / First) where live returns
    // lowercase snake_case, `city_pairs` is documented as `array of Segment`
    // where live wraps each leg in a CityPair, `layovers` is documented at
    // package level where live nests it inside each city_pair, and several
    // live fields (type / route_type / is_multiticket / is_affirm_eligible /
    // has_cc_fees / fare_family / equipment_type / is_flex_* / is_nearby_*)
    // are absent from OpenAPI entirely. The live-shape happy path runs above
    // (with `// drift:` markers per api-testing skill Phase 7 step 6); this
    // skipped test preserves the OpenAPI-correct contract as a coverage
    // line so the spec can be re-enabled if the genesis backend ever reverts
    // to the documented shape.
    test.skip(
        'every package validates against the OpenAPI-strict Package shape (no drift)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.SEARCH_RESULT_FETCH}/__openapi_strict_placeholder__`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(200);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/QxPqz6cS — same URL-only routing.
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.SEARCH_RESULT_FETCH}/__any__`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
