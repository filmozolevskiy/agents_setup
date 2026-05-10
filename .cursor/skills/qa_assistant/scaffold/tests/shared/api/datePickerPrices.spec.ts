import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    DatePickerPricesResponse,
    DatePickerPricesResponseSchema,
    DatePickerPricesSuccessSchema,
    DatePickerPricesFailureSchema,
} from '../../../fixtures/api/schemas/shared/searchContextSchema';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

test.describe('genesis Storefront API — /storefront-api/date-picker-prices', () => {
    test(
        'get with `YUL/JFK/roundtrip` returns 200 with success: true and a price map',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<DatePickerPricesResponse>(
                {
                    method: 'GET',
                    url: `${ApiEndpoints.DATE_PICKER_PRICES}/YUL/JFK/roundtrip`,
                    baseUrl: apiUrl,
                }
            );

            expect(status).toBe(200);
            expect(DatePickerPricesSuccessSchema.parse(body)).toBeTruthy();
            const parsed = DatePickerPricesSuccessSchema.parse(body);
            expect(parsed.success).toBe(true);
            expect(Object.keys(parsed.data.prices).length).toBeGreaterThan(0);
        }
    );

    test(
        'get with `YUL/JFK/oneway` returns 200 with success: true',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<DatePickerPricesResponse>(
                {
                    method: 'GET',
                    url: `${ApiEndpoints.DATE_PICKER_PRICES}/YUL/JFK/oneway`,
                    baseUrl: apiUrl,
                }
            );

            expect(status).toBe(200);
            expect(DatePickerPricesSuccessSchema.parse(body)).toBeTruthy();
            const parsed = DatePickerPricesSuccessSchema.parse(body);
            expect(parsed.success).toBe(true);
        }
    );

    test(
        'get with invalid `trip_type=foobar` returns 200 with success: false (live API does not use 4xx)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<DatePickerPricesResponse>(
                {
                    method: 'GET',
                    url: `${ApiEndpoints.DATE_PICKER_PRICES}/YUL/JFK/foobar`,
                    baseUrl: apiUrl,
                }
            );

            expect(status).toBe(200);
            expect(DatePickerPricesFailureSchema.parse(body)).toBeTruthy();
            const parsed = DatePickerPricesFailureSchema.parse(body);
            expect(parsed.success).toBe(false);
            expect(parsed.reason).toBe('invalid_params');
        }
    );

    test(
        'get with invalid airport code `ZZZ/JFK/roundtrip` returns 200 with success: false reason `not_found`',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<DatePickerPricesResponse>(
                {
                    method: 'GET',
                    url: `${ApiEndpoints.DATE_PICKER_PRICES}/ZZZ/JFK/roundtrip`,
                    baseUrl: apiUrl,
                }
            );

            expect(status).toBe(200);
            expect(DatePickerPricesFailureSchema.parse(body)).toBeTruthy();
            const parsed = DatePickerPricesFailureSchema.parse(body);
            expect(parsed.success).toBe(false);
            expect(parsed.reason).toBe('not_found');
        }
    );

    test(
        'get with optional `currency=USD` query is accepted and returns 200',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<DatePickerPricesResponse>(
                {
                    method: 'GET',
                    url: `${ApiEndpoints.DATE_PICKER_PRICES}/YUL/JFK/roundtrip?currency=USD`,
                    baseUrl: apiUrl,
                }
            );

            expect(status).toBe(200);
            expect(DatePickerPricesResponseSchema.parse(body)).toBeTruthy();
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/KPfxrKkX — the OpenAPI spec marks all
    // three path params required, so omitting one (e.g. trailing `/roundtrip`
    // dropped) should be a 404 from the router. Live staging2 instead leaks
    // a 500 with a PHP `ArgumentCountError` stack trace
    // (`Too few arguments to function ::actionDatePickerPrices(), 2 passed`).
    // Same root-cause family as the airports-nearby 500 leak (aqt8sucM).
    test.skip(
        'get with missing `trip_type` path param returns 404 (live returns 500 with PHP ArgumentCountError stack trace)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.DATE_PICKER_PRICES}/YUL/JFK`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(404);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/KPfxrKkX — OpenAPI declares only `GET`.
    // Live API likely accepts other verbs (same pattern as airports). Skipped
    // until the verb is enforced.
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; URL-only routing on genesis ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.DATE_PICKER_PRICES}/YUL/JFK/roundtrip`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
