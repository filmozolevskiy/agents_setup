import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    SearchInitResponse,
    SearchInitResponseSchema,
} from '../../../fixtures/api/schemas/shared/searchSchema';
import { INVALID_ENUM_VALUES } from '../../../test-data/static/util/invalid-values';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

const HAPPY_PARAMS = new URLSearchParams({
    num_adults: '1',
    num_children: '0',
    num_infants: '0',
    num_infants_lap: '0',
    seat_class: 'Economy',
    seg0_date: '2026-08-15',
    seg0_from: 'YUL',
    seg0_to: 'JFK',
    type: 'oneway',
    surfer_id: 'shared_search_init_spec',
});

test.describe('genesis Storefront API — /storefront-api/search-init', () => {
    test(
        'get with all required oneway params returns 200 and a non-null search_id',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<SearchInitResponse>({
                method: 'GET',
                url: `${ApiEndpoints.SEARCH_INIT}?${HAPPY_PARAMS.toString()}`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(SearchInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = SearchInitResponseSchema.parse(body);
            expect(parsed.search_id).not.toBeNull();
            expect(parsed.search_id?.length).toBeGreaterThan(0);
        }
    );

    test(
        'get with required `num_adults` omitted returns 200 with search_id: null (live soft-fail; OpenAPI says 400)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const params = new URLSearchParams(HAPPY_PARAMS);
            params.delete('num_adults');

            const { status, body } = await apiRequest<SearchInitResponse>({
                method: 'GET',
                url: `${ApiEndpoints.SEARCH_INIT}?${params.toString()}`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(SearchInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = SearchInitResponseSchema.parse(body);
            expect(parsed.search_id).toBeNull();
        }
    );

    // FIXME: https://trello.com/c/QxPqz6cS — `seat_class` enum
    // [Economy, EconomyPremium, Business, First] not enforced by the live
    // API. Iterating universal `INVALID_ENUM_VALUES` (per the
    // data-strategy three-tier rule) so coverage matches the per-field
    // `for...of` pattern used elsewhere; live response is the active
    // soft-fail (200 with a valid search_id), the OpenAPI-correct 400 is
    // captured separately in the skip block below.
    for (const invalidSeatClass of INVALID_ENUM_VALUES) {
        test(
            `get with invalid \`seat_class=${JSON.stringify(invalidSeatClass)}\` still returns 200 with a valid search_id (live drift)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const params = new URLSearchParams(HAPPY_PARAMS);
                params.set('seat_class', String(invalidSeatClass));

                const { status, body } = await apiRequest<SearchInitResponse>({
                    method: 'GET',
                    url: `${ApiEndpoints.SEARCH_INIT}?${params.toString()}`,
                    baseUrl: apiUrl,
                });

                expect(status).toBe(200);
                expect(SearchInitResponseSchema.parse(body)).toBeTruthy();
                const parsed = SearchInitResponseSchema.parse(body);
                expect(parsed.search_id?.length).toBeGreaterThan(0);
            }
        );
    }

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/QxPqz6cS — OpenAPI marks all 8 query params
    // (`num_adults`, `num_children`, `num_infants`, `num_infants_lap`,
    // `seat_class`, `seg0_date`, `seg0_from`, `seg0_to`, `type`, `surfer_id`)
    // as `required: true`. Live API soft-fails with 200 + `search_id: null`
    // for every one of them.
    const REQUIRED_PARAMS = [
        'num_adults',
        'num_children',
        'num_infants',
        'num_infants_lap',
        'seat_class',
        'seg0_date',
        'seg0_from',
        'seg0_to',
        'type',
        'surfer_id',
    ] as const;
    for (const omitted of REQUIRED_PARAMS) {
        test.skip(
            `get without \`${omitted}\` returns 400 (OpenAPI contract; live returns 200 with search_id null)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const params = new URLSearchParams(HAPPY_PARAMS);
                params.delete(omitted);
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.SEARCH_INIT}?${params.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(400);
            }
        );
    }
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/QxPqz6cS — `seat_class` enum
    // [Economy, EconomyPremium, Business, First] not enforced; `type` enum
    // [roundtrip, oneway, multi] also unverified. OpenAPI-correct happy
    // path captured here as `test.skip` per Phase 7; the active live drift
    // is exercised by the per-INVALID_ENUM_VALUES loop above.
    for (const invalidSeatClass of INVALID_ENUM_VALUES) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `get with invalid \`seat_class=${JSON.stringify(invalidSeatClass)}\` returns 400 (OpenAPI enum; live ignores it)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const params = new URLSearchParams(HAPPY_PARAMS);
                params.set('seat_class', String(invalidSeatClass));
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.SEARCH_INIT}?${params.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(400);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }

    // FIXME: https://trello.com/c/QxPqz6cS — same URL-only routing.
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.SEARCH_INIT}?${HAPPY_PARAMS.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
