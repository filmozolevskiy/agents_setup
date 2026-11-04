import { randomBytes } from 'crypto';
import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    PastSearchesResponse,
    PastSearchesResponseSchema,
} from '../../../fixtures/api/schemas/shared/searchContextSchema';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

/**
 * Build a fresh, ≤32-char surfer_id for the populated past-searches
 * round-trip test. The genesis storage layer truncates / drops surfer_ids
 * longer than 32 chars (likely a `VARCHAR(32)` column), so the standard
 * `surferId(scope)` factory under `test-data/factories/shared/genesisAuth`
 * (31+ chars) will not round-trip — see the schema's `// drift:` note.
 */
function shortSurferId(): string {
    return randomBytes(16).toString('hex');
}

test.describe('genesis Storefront API — /storefront-api/past-searches', () => {
    test(
        'get with the OpenAPI example surferId returns 200 and an array (live empty)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<PastSearchesResponse>({
                method: 'GET',
                url: `${ApiEndpoints.PAST_SEARCHES}/17d99c1499ee4115a04a828e5c884961`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(PastSearchesResponseSchema.parse(body)).toBeTruthy();
            const parsed = PastSearchesResponseSchema.parse(body);
            expect(Array.isArray(parsed)).toBe(true);
        }
    );

    test(
        'get with a random surferId returns 200 and an empty array',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<PastSearchesResponse>({
                method: 'GET',
                url: `${ApiEndpoints.PAST_SEARCHES}/zzzzzz`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(PastSearchesResponseSchema.parse(body)).toBeTruthy();
            expect(PastSearchesResponseSchema.parse(body)).toHaveLength(0);
        }
    );

    test(
        'get after seeding via search-init returns 200 with a strict per-item PastSearchItem array',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const surferId = shortSurferId();

            await test.step('Seed the past-searches record by calling search-init with a known short surfer_id', async () => {
                const params = new URLSearchParams({
                    num_adults: '1',
                    num_children: '0',
                    num_infants: '0',
                    num_infants_lap: '0',
                    seat_class: 'Economy',
                    seg0_date: '2026-08-15',
                    seg0_from: 'YUL',
                    seg0_to: 'JFK',
                    type: 'oneway',
                    surfer_id: surferId,
                });
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.SEARCH_INIT}?${params.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(200);
            });

            await test.step('Fetch past-searches for the same surfer_id and validate the strict per-item schema', async () => {
                const { status, body } = await apiRequest<PastSearchesResponse>(
                    {
                        method: 'GET',
                        url: `${ApiEndpoints.PAST_SEARCHES}/${surferId}`,
                        baseUrl: apiUrl,
                    }
                );

                expect(status).toBe(200);
                expect(PastSearchesResponseSchema.parse(body)).toBeTruthy();
                const parsed = PastSearchesResponseSchema.parse(body);
                expect(parsed.length).toBeGreaterThan(0);
                expect(parsed[0]?.from_code).toBe('YUL');
                expect(parsed[0]?.to_code).toBe('JFK');
                expect(parsed[0]?.search_params.type).toBe('oneway');
            });
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/KPfxrKkX — missing path param should be
    // 404; live likely 500 with PHP ArgumentCountError stack trace per
    // date-picker-prices precedent.
    test.skip(
        'get with no `surferId` returns 404 (live likely 500 PHP ArgumentCountError)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: ApiEndpoints.PAST_SEARCHES,
                baseUrl: apiUrl,
            });
            expect(status).toBe(404);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/KPfxrKkX — POST/PUT/DELETE/PATCH expected
    // to return 200 same as GET (URL-only routing on genesis).
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.PAST_SEARCHES}/zzzzzz`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
