import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    TopDealsResponse,
    TopDealsResponseSchema,
} from '../../../fixtures/api/schemas/shared/searchContextSchema';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

test.describe('genesis Storefront API — /storefront-api/top-deals', () => {
    test(
        'get with `departingCityCode=YUL` and no query params returns 200 and a list of top deals',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<TopDealsResponse>({
                method: 'GET',
                url: `${ApiEndpoints.TOP_DEALS}/YUL`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(TopDealsResponseSchema.parse(body)).toBeTruthy();
            const parsed = TopDealsResponseSchema.parse(body);
            expect(parsed.length).toBeGreaterThan(0);
            expect(parsed[0].from_code).toBe('YUL');
        }
    );

    test(
        'get with full query (lat/lon/country_code) returns 200 and an empty list (live behaviour — drift)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<TopDealsResponse>({
                method: 'GET',
                url: `${ApiEndpoints.TOP_DEALS}/YUL?latitude=45.5&longitude=-73.6&country_code=CAN`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(TopDealsResponseSchema.parse(body)).toBeTruthy();
            expect(TopDealsResponseSchema.parse(body)).toHaveLength(0);
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/KPfxrKkX — OpenAPI marks `latitude`,
    // `longitude` and `country_code` as `required: true`. Live behaviour is
    // inverted: omitting them returns full results, supplying them returns
    // `[]`. Same drift family as airports-nearby.
    for (const omitted of ['latitude', 'longitude', 'country_code'] as const) {
        test.skip(
            `get without \`${omitted}\` returns 400 (OpenAPI contract; live returns 200)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const params = new URLSearchParams({
                    latitude: '45.5',
                    longitude: '-73.6',
                    country_code: 'CAN',
                });
                params.delete(omitted);
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.TOP_DEALS}/YUL?${params.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(400);
            }
        );
    }
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/KPfxrKkX — POST/PUT/DELETE/PATCH return
    // 200 same as GET (URL-only routing).
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.TOP_DEALS}/YUL`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
