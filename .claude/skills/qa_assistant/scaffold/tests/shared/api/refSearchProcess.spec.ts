import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, GenesisErrorCodes } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import { AuthFailureEnvelope } from '../../../fixtures/api/schemas/shared/authSchema';
import {
    RefSearchProcessResponse,
    RefSearchProcessResponseSchema,
    RefSearchProcessSuccessSchema,
} from '../../../fixtures/api/schemas/shared/referenceSearchSchema';
import {
    personName,
    surferId,
    validTotp,
} from '../../../test-data/factories/shared/genesisAuth.factory';
import { seededBooking } from '../../../helpers/shared/seededBooking';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/ref-search-process', () => {
    test(
        'post with no body returns 200 with the not-found failure envelope (same code is reused for invalid-throttle and not-found)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<RefSearchProcessResponse>(
                {
                    method: 'POST',
                    url: ApiEndpoints.REF_SEARCH_PROCESS,
                    baseUrl: apiUrl,
                    body: {},
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('ref_search_process')
                    ),
                }
            );

            expect(status).toBe(200);
            expect(RefSearchProcessResponseSchema.parse(body)).toBeTruthy();
            const parsed = RefSearchProcessResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.REF_SEARCH_PROCESS_NOT_FOUND
            );
        }
    );

    test(
        'post with an unknown booking_id returns 200 with the not-found failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<RefSearchProcessResponse>(
                {
                    method: 'POST',
                    url: ApiEndpoints.REF_SEARCH_PROCESS,
                    baseUrl: apiUrl,
                    body: {
                        booking_id: '999999999',
                        last_name: personName().last_name,
                        totp: validTotp(),
                    },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('ref_search_process')
                    ),
                }
            );

            expect(status).toBe(200);
            expect(RefSearchProcessResponseSchema.parse(body)).toBeTruthy();
            const parsed = RefSearchProcessResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.REF_SEARCH_PROCESS_NOT_FOUND
            );
        }
    );

    test(
        'post with real {booking_id, last_name, totp: any} returns 200 with success: true (handler ignores totp; live drift)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const booking = seededBooking();

            const { status, body } = await apiRequest<RefSearchProcessResponse>(
                {
                    method: 'POST',
                    url: ApiEndpoints.REF_SEARCH_PROCESS,
                    baseUrl: apiUrl,
                    body: {
                        booking_id: booking.bookingId,
                        last_name: booking.lastName,
                        totp: validTotp(),
                    },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('ref_search_process')
                    ),
                }
            );

            expect(status).toBe(200);
            expect(RefSearchProcessSuccessSchema.parse(body)).toBeTruthy();
            const parsed = RefSearchProcessSuccessSchema.parse(body);
            expect(parsed.success).toBe(true);
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/zBkrosRx — OpenAPI declares the success
    // response as `{success: true, hash_id: string}` (per the @OA\Schema
    // block on `actionRefSearchProcess`). The live handler only sets
    // `success: true` and never returns a `hash_id` (line 5210 of
    // `Mv/Ota/Jfly/App/StorefrontApi.php`). The live-shape happy path
    // runs above; this skipped test preserves the OpenAPI contract as a
    // coverage line so the spec can be re-enabled if the genesis backend
    // ever ships the documented `hash_id` field.
    test.skip(
        'happy-path response includes hash_id per OpenAPI (live: hash_id is never returned)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const booking = seededBooking();
            const { body } = await apiRequest<{ hash_id?: string }>({
                method: 'POST',
                url: ApiEndpoints.REF_SEARCH_PROCESS,
                baseUrl: apiUrl,
                body: {
                    booking_id: booking.bookingId,
                    last_name: booking.lastName,
                    totp: validTotp(),
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('ref_search_process')
                ),
            });
            expect(body?.hash_id).toBeTruthy();
        }
    );

    // FIXME: https://trello.com/c/zBkrosRx — OpenAPI marks `totp` as
    // required and as a TOTP validator, but the handler never validates
    // it. A spec-compliant test would expect 400 / 200 with
    // `{success: false, error_code: 3000041}` for a wrong TOTP — live
    // returns success (the live happy path above proves it).
    test.skip(
        'post with real booking + wrong totp returns 200 with the invalid-TOTP failure envelope (live: handler ignores totp)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const booking = seededBooking();
            const { status } = await apiRequest({
                method: 'POST',
                url: ApiEndpoints.REF_SEARCH_PROCESS,
                baseUrl: apiUrl,
                body: {
                    booking_id: booking.bookingId,
                    last_name: booking.lastName,
                    totp: '000000',
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('ref_search_process')
                ),
            });
            expect(status).toBe(200);
        }
    );

    // FIXME: https://trello.com/c/zBkrosRx — same OpenAPI vs body-field
    // drift family as the auth & account endpoints (Ku80mryj).
    test.skip(
        'post with documented query params returns 200 with success per OpenAPI (live: failure envelope, body fields ignored)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const booking = seededBooking();
            const params = new URLSearchParams({
                booking_id: booking.bookingId,
                last_name: booking.lastName,
                totp: validTotp(),
                surfer_id: surferId('ref_search_process_query'),
            });
            const { status } = await apiRequest({
                method: 'POST',
                url: `${ApiEndpoints.REF_SEARCH_PROCESS}?${params.toString()}`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(200);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/zBkrosRx — POST-only per OpenAPI; live
    // accepts every verb.
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: ApiEndpoints.REF_SEARCH_PROCESS,
                    baseUrl: apiUrl,
                    body: {
                        booking_id: '123456789',
                        last_name: personName().last_name,
                        totp: validTotp(),
                    },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('ref_search_process')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
