import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    GetAeroplansResponse,
    GetAeroplansResponseSchema,
} from '../../../fixtures/api/schemas/shared/searchContextSchema';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

test.describe('genesis Storefront API — /storefront-api/get-aeroplans', () => {
    test(
        'get returns 200 and a non-empty airline-code -> aeroplan-name map',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<GetAeroplansResponse>({
                method: 'GET',
                url: ApiEndpoints.GET_AEROPLANS,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(GetAeroplansResponseSchema.parse(body)).toBeTruthy();
            const parsed = GetAeroplansResponseSchema.parse(body);
            expect(Object.keys(parsed).length).toBeGreaterThan(0);
            expect(parsed.AC).toBe('Air Canada Aeroplan');
        }
    );

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
                    url: ApiEndpoints.GET_AEROPLANS,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
