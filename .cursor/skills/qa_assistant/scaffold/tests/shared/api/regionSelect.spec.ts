import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    RegionSelectResponse,
    RegionSelectResponseSchema,
} from '../../../fixtures/api/schemas/shared/searchContextSchema';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

test.describe('genesis Storefront API — /storefront-api/region-select', () => {
    test(
        'get with `country_code=CA` returns 200 and a non-empty region map',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<RegionSelectResponse>({
                method: 'GET',
                url: `${ApiEndpoints.REGION_SELECT}/CA`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(RegionSelectResponseSchema.parse(body)).toBeTruthy();
            const parsed = RegionSelectResponseSchema.parse(body);
            // eslint-disable-next-line playwright/no-conditional-in-test -- narrow live `Record | []` union; throws on the wrong-arm drift case
            if (Array.isArray(parsed)) {
                throw new Error(
                    'expected populated region map for CA, got empty array drift'
                );
            }
            expect(parsed.QC).toBe('Quebec');
        }
    );

    test(
        'get with unknown `country_code=XX` returns 200 and an empty array (drift; should be {})',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<RegionSelectResponse>({
                method: 'GET',
                url: `${ApiEndpoints.REGION_SELECT}/XX`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(RegionSelectResponseSchema.parse(body)).toBeTruthy();
            const parsed = RegionSelectResponseSchema.parse(body);
            // eslint-disable-next-line playwright/no-conditional-in-test -- narrow live `Record | []` union; throws on the wrong-arm drift case
            if (!Array.isArray(parsed)) {
                throw new Error(
                    'expected empty-array drift for unknown country code, got region map'
                );
            }
            expect(parsed).toHaveLength(0);
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/KPfxrKkX — missing path param should be a
    // 404 from the router; live API behaviour matches the date-picker case
    // (likely 500 with PHP ArgumentCountError). Skipped until the router
    // honours required path params.
    test.skip(
        'get with no `country_code` returns 404 (live likely 500 PHP ArgumentCountError)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: ApiEndpoints.REGION_SELECT,
                baseUrl: apiUrl,
            });
            expect(status).toBe(404);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/KPfxrKkX — same drift family: genesis
    // dispatches by URL only, so non-GET verbs return 200.
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.REGION_SELECT}/CA`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
