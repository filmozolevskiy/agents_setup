import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, GenesisErrorCodes } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import {
    AuthFailureEnvelope,
    ResendTotpResponse,
    ResendTotpResponseSchema,
    ResendTotpSuccess,
} from '../../../fixtures/api/schemas/shared/authSchema';
import {
    surferId,
    unseenEmail,
} from '../../../test-data/factories/shared/genesisAuth.factory';
import { seededBooking } from '../../../helpers/shared/seededBooking';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/resend-totp', () => {
    test(
        'post with an `email` body returns 200 with success: true (handler dispatches a TOTP email; live drift — does not check whether an active customer matches the email)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<ResendTotpResponse>({
                method: 'POST',
                url: ApiEndpoints.RESEND_TOTP,
                baseUrl: apiUrl,
                body: { email: unseenEmail('resend_totp') },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('resend_totp')
                ),
            });

            expect(status).toBe(200);
            expect(ResendTotpResponseSchema.parse(body)).toBeTruthy();
            const parsed = ResendTotpResponseSchema.parse(body);
            expect((parsed as ResendTotpSuccess).success).toBe(true);
        }
    );

    test(
        'post with no body returns 200 with the missing-email failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<ResendTotpResponse>({
                method: 'POST',
                url: ApiEndpoints.RESEND_TOTP,
                baseUrl: apiUrl,
                body: {},
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('resend_totp')
                ),
            });

            expect(status).toBe(200);
            expect(ResendTotpResponseSchema.parse(body)).toBeTruthy();
            const parsed = ResendTotpResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.RESEND_TOTP_THROTTLED
            );
        }
    );

    test(
        'post with `{booking_id, last_name}` for a real booking returns 200 with success: true (dispatches a TOTP email to the booking contact)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const booking = seededBooking();

            const { status, body } = await apiRequest<ResendTotpResponse>({
                method: 'POST',
                url: ApiEndpoints.RESEND_TOTP,
                baseUrl: apiUrl,
                body: {
                    booking_id: booking.bookingId,
                    last_name: booking.lastName,
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('resend_totp')
                ),
            });

            expect(status).toBe(200);
            expect(ResendTotpResponseSchema.parse(body)).toBeTruthy();
            const parsed = ResendTotpResponseSchema.parse(body);
            expect((parsed as ResendTotpSuccess).success).toBe(true);
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/Ku80mryj — same OpenAPI vs body-field
    // drift family as `check-email` / `login-init`.
    test.skip(
        'post with documented query params returns 200 with success per OpenAPI (live: failure envelope, body fields ignored)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const params = new URLSearchParams({
                email: unseenEmail('resend_totp'),
                surfer_id: surferId('resend_totp'),
            });
            const { status } = await apiRequest({
                method: 'POST',
                url: `${ApiEndpoints.RESEND_TOTP}?${params.toString()}`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(200);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/Ku80mryj — POST-only per OpenAPI; live
    // accepts every verb.
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: ApiEndpoints.RESEND_TOTP,
                    baseUrl: apiUrl,
                    body: { email: unseenEmail('resend_totp') },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('resend_totp')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
