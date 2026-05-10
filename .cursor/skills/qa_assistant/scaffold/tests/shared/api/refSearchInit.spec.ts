import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, GenesisErrorCodes } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import { AuthFailureEnvelope } from '../../../fixtures/api/schemas/shared/authSchema';
import {
    RefSearchInitResponse,
    RefSearchInitResponseSchema,
    RefSearchInitSuccessSchema,
} from '../../../fixtures/api/schemas/shared/referenceSearchSchema';
import {
    personName,
    surferId,
} from '../../../test-data/factories/shared/genesisAuth.factory';
import { seededBooking } from '../../../helpers/shared/seededBooking';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/ref-search-init', () => {
    test(
        'post with no body returns 200 with the missing-fields failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<RefSearchInitResponse>({
                method: 'POST',
                url: ApiEndpoints.REF_SEARCH_INIT,
                baseUrl: apiUrl,
                body: {},
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('ref_search_init')
                ),
            });

            expect(status).toBe(200);
            expect(RefSearchInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = RefSearchInitResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.REF_SEARCH_INIT_MISSING_FIELDS
            );
        }
    );

    test(
        'post with `last_name` only returns 200 with the missing-fields failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<RefSearchInitResponse>({
                method: 'POST',
                url: ApiEndpoints.REF_SEARCH_INIT,
                baseUrl: apiUrl,
                body: { last_name: personName().last_name },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('ref_search_init')
                ),
            });

            expect(status).toBe(200);
            expect(RefSearchInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = RefSearchInitResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.REF_SEARCH_INIT_MISSING_FIELDS
            );
        }
    );

    test(
        'post with an unknown booking_id returns 200 with the not-found failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<RefSearchInitResponse>({
                method: 'POST',
                url: ApiEndpoints.REF_SEARCH_INIT,
                baseUrl: apiUrl,
                body: {
                    booking_id: '999999999',
                    last_name: personName().last_name,
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('ref_search_init')
                ),
            });

            expect(status).toBe(200);
            expect(RefSearchInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = RefSearchInitResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.REF_SEARCH_INIT_BOOKING_NOT_FOUND
            );
        }
    );

    test(
        'post with real {booking_id, last_name} returns 200 with success: true (dispatches a TOTP email to the booking contact)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const booking = seededBooking();

            const { status, body } = await apiRequest<RefSearchInitResponse>({
                method: 'POST',
                url: ApiEndpoints.REF_SEARCH_INIT,
                baseUrl: apiUrl,
                body: {
                    booking_id: booking.bookingId,
                    last_name: booking.lastName,
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('ref_search_init')
                ),
            });

            expect(status).toBe(200);
            expect(RefSearchInitSuccessSchema.parse(body)).toBeTruthy();
            const parsed = RefSearchInitSuccessSchema.parse(body);
            expect(parsed.success).toBe(true);
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/zBkrosRx — same OpenAPI vs body-field
    // drift family as the auth & account endpoints (Ku80mryj). All
    // params declared as query params but the handler reads them from
    // the JSON body.
    test.skip(
        'post with documented query params returns 200 with success per OpenAPI (live: failure envelope, body fields ignored)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const booking = seededBooking();
            const params = new URLSearchParams({
                booking_id: booking.bookingId,
                last_name: booking.lastName,
                surfer_id: surferId('ref_search_init_query'),
            });
            const { status } = await apiRequest({
                method: 'POST',
                url: `${ApiEndpoints.REF_SEARCH_INIT}?${params.toString()}`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(200);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/zBkrosRx — POST-only per OpenAPI; live
    // accepts every verb (same drift family as the rest of storefront-api).
    // Live: GET returns the failure envelope (the throttler rejects the
    // request because `Mv_Request_Throttler::isValidLoginProcessRequest`
    // requires `$request->isPost()`).
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: ApiEndpoints.REF_SEARCH_INIT,
                    baseUrl: apiUrl,
                    body: {
                        booking_id: '123456789',
                        last_name: personName().last_name,
                    },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('ref_search_init')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
