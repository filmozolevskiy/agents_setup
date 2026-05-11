import { expect, test } from '../../../fixtures/pom/test-options';
import {
    ApiEndpoints,
    GenesisErrorCodes,
    Messages,
} from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    TaxBreakdownFailure,
    TaxBreakdownFailureSchema,
    TaxBreakdownResponse,
    TaxBreakdownSuccessSchema,
} from '../../../fixtures/api/schemas/shared/searchSchema';
import { seedSearchPair } from '../../../helpers/shared/searchSetup';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

test.describe('genesis Storefront API — /storefront-api/get-tax-breakdown', () => {
    test(
        'get with invalid searchId / packageId returns 200 with the failure envelope (live drift; OpenAPI implies 404)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<TaxBreakdownFailure>({
                method: 'GET',
                url: `${ApiEndpoints.GET_TAX_BREAKDOWN}/INVALID_SEARCH/INVALID_PKG`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(TaxBreakdownFailureSchema.parse(body)).toBeTruthy();
            const parsed = TaxBreakdownFailureSchema.parse(body);
            expect(parsed.success).toBe(false);
            expect(parsed.error_message).toBe(Messages.PACKAGE_NOT_FOUND);
            expect(parsed.error_code).toBe(GenesisErrorCodes.PACKAGE_NOT_FOUND);
        }
    );

    test(
        'get with a real (searchId, packageId) pair returns 200 with a strict TaxBreakdown payload',
        { tag: '@api' },
        async ({ apiRequest }) => {
            let searchId = '';
            let packageId = '';

            await test.step('seed a real (searchId, packageId) pair via search-init → search-result-fetch', async () => {
                const seeded = await seedSearchPair({ apiRequest, apiUrl });
                searchId = seeded.searchId;
                packageId = seeded.packageId;
            });

            await test.step('GET /get-tax-breakdown returns the strict {tax_breakdown: <pax → tax_code → amount>} envelope', async () => {
                const { status, body } = await apiRequest<TaxBreakdownResponse>(
                    {
                        method: 'GET',
                        url: `${ApiEndpoints.GET_TAX_BREAKDOWN}/${searchId}/${packageId}`,
                        baseUrl: apiUrl,
                    }
                );
                expect(status).toBe(200);
                expect(TaxBreakdownSuccessSchema.parse(body)).toBeTruthy();
                const parsed = TaxBreakdownSuccessSchema.parse(body);
                const paxTypes = Object.keys(parsed.tax_breakdown);
                expect(paxTypes.length).toBeGreaterThan(0);
                expect(paxTypes).toContain('adt');
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
                url: `${ApiEndpoints.GET_TAX_BREAKDOWN}/INVALID_SEARCH`,
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
                    url: `${ApiEndpoints.GET_TAX_BREAKDOWN}/INVALID/INVALID`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
