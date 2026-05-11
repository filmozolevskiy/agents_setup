import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    AirportsAutocompleteResponse,
    AirportsAutocompleteResponseSchema,
    AirportsNearbyResponse,
    AirportsNearbyResponseSchema,
} from '../../../fixtures/api/schemas/shared/airportsSchema';
import {
    INVALID_COUNTRY_CODE_VALUES,
    NEARBY_NON_NUMERIC_LAT_LON_VALUES,
} from '../../../test-data/static/shared/invalidAirportInputs';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

const NEARBY_QUERY =
    'latitude=45.51686574455807&longitude=-73.65012455994948&country_code=CAN';

test.describe('genesis Storefront API — /storefront-api/airports-autocomplete', () => {
    test(
        'get with a real `term` returns 200 and an array of AirportInfo',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } =
                await apiRequest<AirportsAutocompleteResponse>({
                    method: 'GET',
                    url: `${ApiEndpoints.AIRPORTS_AUTOCOMPLETE}?term=New%20Y`,
                    baseUrl: apiUrl,
                });

            expect(status).toBe(200);
            expect(AirportsAutocompleteResponseSchema.parse(body)).toBeTruthy();
            const parsed = AirportsAutocompleteResponseSchema.parse(body);
            expect(parsed.length).toBeGreaterThan(0);
            expect(parsed[0].code.length).toBeGreaterThan(0);
            expect(parsed[0].raw_code.length).toBeGreaterThan(0);
        }
    );

    test(
        'get with an empty `term` returns 200 and an empty array',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } =
                await apiRequest<AirportsAutocompleteResponse>({
                    method: 'GET',
                    url: `${ApiEndpoints.AIRPORTS_AUTOCOMPLETE}?term=`,
                    baseUrl: apiUrl,
                });

            expect(status).toBe(200);
            expect(AirportsAutocompleteResponseSchema.parse(body)).toBeTruthy();
            expect(AirportsAutocompleteResponseSchema.parse(body)).toHaveLength(
                0
            );
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/aqt8sucM — OpenAPI marks `term` as
    // `required: true` (openapi.yaml line 16), so missing `term` should
    // produce 400. Live staging2 returns 200 with `[]`. The permissive
    // behaviour is documented above by the empty-`term` test.
    test.skip(
        'get without `term` returns 400 (OpenAPI contract; live returns 200 [])',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: ApiEndpoints.AIRPORTS_AUTOCOMPLETE,
                baseUrl: apiUrl,
            });
            expect(status).toBe(400);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/aqt8sucM — OpenAPI declares only `GET` for
    // this endpoint; POST / PUT / DELETE / PATCH should produce 405. Live
    // staging2 returns 200 with the autocomplete results regardless of method
    // (genesis routes the action by URL, ignoring the HTTP verb).
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live returns 200 with results)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.AIRPORTS_AUTOCOMPLETE}?term=New`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});

test.describe('genesis Storefront API — /storefront-api/airports-nearby', () => {
    test(
        'get with valid `latitude` / `longitude` / `country_code` returns 200 and a populated AirportInfo map',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<AirportsNearbyResponse>({
                method: 'GET',
                url: `${ApiEndpoints.AIRPORTS_NEARBY}?${NEARBY_QUERY}`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(AirportsNearbyResponseSchema.parse(body)).toBeTruthy();
            const parsed = AirportsNearbyResponseSchema.parse(body);
            // eslint-disable-next-line playwright/no-conditional-in-test -- live shape varies (Array vs Record); see schema JSDoc
            const airports = Array.isArray(parsed)
                ? parsed
                : Object.values(parsed);
            expect(airports.length).toBeGreaterThan(0);
            expect(airports[0].country_code).toBe('CA');
        }
    );

    test(
        'get against an open-ocean point returns 200 and an empty list',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<AirportsNearbyResponse>({
                method: 'GET',
                url: `${ApiEndpoints.AIRPORTS_NEARBY}?latitude=0&longitude=0&country_code=CAN`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(AirportsNearbyResponseSchema.parse(body)).toBeTruthy();
            const parsed = AirportsNearbyResponseSchema.parse(body);
            // eslint-disable-next-line playwright/no-conditional-in-test -- live shape varies (Array vs Record); see schema JSDoc
            const airports = Array.isArray(parsed)
                ? parsed
                : Object.values(parsed);
            expect(airports).toHaveLength(0);
        }
    );

    // FIXME: https://trello.com/c/aqt8sucM — OpenAPI marks all three query
    // params (latitude, longitude, country_code) as `required: true`. Live
    // staging2 ignores the contract and returns 200 with default Montreal
    // results when any single param is omitted.
    for (const omitted of ['latitude', 'longitude', 'country_code'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `get without \`${omitted}\` returns 400 (OpenAPI contract; live returns 200 with default Montreal results)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const params = new URLSearchParams({
                    latitude: '45.51',
                    longitude: '-73.65',
                    country_code: 'CAN',
                });
                params.delete(omitted);
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.AIRPORTS_NEARBY}?${params.toString()}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(400);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }

    // FIXME: https://trello.com/c/aqt8sucM — OpenAPI describes
    // `country_code` as ISO 3166-1 alpha-3 (3 uppercase letters). Live API
    // returns 200 with default Montreal results for `XYZ` (and any other
    // value) — no validation on the value at all.
    for (const value of INVALID_COUNTRY_CODE_VALUES) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `get with invalid \`country_code=${JSON.stringify(value)}\` returns 400 (live returns 200 with default Montreal results)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.AIRPORTS_NEARBY}?latitude=45.51&longitude=-73.65&country_code=${encodeURIComponent(value)}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(400);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }

    // FIXME: https://trello.com/c/aqt8sucM — OpenAPI declares only `GET`.
    // Live staging2 returns 200 with results for POST / PUT / DELETE / PATCH
    // (same root cause as the autocomplete endpoint — genesis dispatches by
    // URL, not by HTTP verb).
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live returns 200 with results)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: `${ApiEndpoints.AIRPORTS_NEARBY}?${NEARBY_QUERY}`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }

    // FIXME: https://trello.com/c/aqt8sucM — non-numeric `latitude` /
    // `longitude` (e.g. `abc`, `true`, `null`) crashes the backend with a
    // 500 PHP TypeError that leaks the full stack trace to the response body
    // (`Mv_Ota_Airport_Helper::getClosestAirports(): Argument #1 ($lat) must
    // be of type float, string given`). Should be a 400 with the genesis
    // error envelope. Active reproducer of the 500 is the next test below.
    for (const value of NEARBY_NON_NUMERIC_LAT_LON_VALUES) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `get with non-numeric \`latitude=${value}\` returns 400 (live returns 500 with PHP TypeError stack trace)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.AIRPORTS_NEARBY}?latitude=${encodeURIComponent(value)}&longitude=-73.65&country_code=CAN`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(400);
            }
        );

        test.skip(
            `get with non-numeric \`longitude=${value}\` returns 400 (live returns 500 with PHP TypeError stack trace)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method: 'GET',
                    url: `${ApiEndpoints.AIRPORTS_NEARBY}?latitude=45.51&longitude=${encodeURIComponent(value)}&country_code=CAN`,
                    baseUrl: apiUrl,
                });
                expect(status).toBe(400);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }

    // Active reproducer for the 500 PHP-stack-trace leak. Asserts only the
    // status code so the test stays robust to any change in the backend log
    // format — the symptom we want flagged is "this returns 500 instead of
    // 400", not the specific shape of the leaked stack trace. When the
    // backend bug is fixed, status will become 400 and this test will fail
    // — that is the desired signal to flip it back to a normal 400 test.
    test(
        'get with non-numeric `latitude=abc` actually returns 500 (active reproducer for the backend bug)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.AIRPORTS_NEARBY}?latitude=abc&longitude=-73.65&country_code=CAN`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(500);
        }
    );
});
