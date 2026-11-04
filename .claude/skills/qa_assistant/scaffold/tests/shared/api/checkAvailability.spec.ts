import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    CheckAvailabilityFailure,
    CheckAvailabilityFailureSchema,
    CheckAvailabilityResponse,
    CheckAvailabilitySuccessSchema,
} from '../../../fixtures/api/schemas/shared/searchSchema';
import { seedSearchPair } from '../../../helpers/shared/searchSetup';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

test.describe('genesis Storefront API — /storefront-api/check-availability', () => {
    test(
        'get with invalid searchId / packageId returns 200 with the failure envelope (live drift; OpenAPI implies 404)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<CheckAvailabilityFailure>(
                {
                    method: 'GET',
                    url: `${ApiEndpoints.CHECK_AVAILABILITY}/INVALID_SEARCH/INVALID_PKG`,
                    baseUrl: apiUrl,
                }
            );

            expect(status).toBe(200);
            expect(CheckAvailabilityFailureSchema.parse(body)).toBeTruthy();
            const parsed = CheckAvailabilityFailureSchema.parse(body);
            expect(parsed.success).toBe(false);
            expect(parsed.package).toBeNull();
        }
    );

    test(
        'get with a real (searchId, packageId) pair returns 200 with a non-null package and success: true',
        { tag: '@api' },
        async ({ apiRequest }) => {
            let searchId = '';
            let packageId = '';

            await test.step('seed a real (searchId, packageId) pair via search-init → search-result-fetch', async () => {
                const seeded = await seedSearchPair({ apiRequest, apiUrl });
                searchId = seeded.searchId;
                packageId = seeded.packageId;
            });

            await test.step('GET /check-availability returns the success envelope with the live Package shape', async () => {
                const { status, body } =
                    await apiRequest<CheckAvailabilityResponse>({
                        method: 'GET',
                        url: `${ApiEndpoints.CHECK_AVAILABILITY}/${searchId}/${packageId}`,
                        baseUrl: apiUrl,
                    });
                expect(status).toBe(200);
                expect(CheckAvailabilitySuccessSchema.parse(body)).toBeTruthy();
                const parsed = CheckAvailabilitySuccessSchema.parse(body);
                expect(parsed.success).toBe(true);
                expect(parsed.package.city_pairs.length).toBeGreaterThan(0);
                expect(parsed.package.price.currency).toMatch(/^[A-Z]{3}$/);
            });
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/QxPqz6cS — missing path param expected
    // 404 from router; live likely 500 PHP ArgumentCountError per
    // date-picker / region-select precedent.
    test.skip(
        'get with a missing `packageId` path segment returns 404 (live likely 500 PHP ArgumentCountError)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.CHECK_AVAILABILITY}/INVALID_SEARCH`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(404);
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
                    url: `${ApiEndpoints.CHECK_AVAILABILITY}/INVALID/INVALID`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
