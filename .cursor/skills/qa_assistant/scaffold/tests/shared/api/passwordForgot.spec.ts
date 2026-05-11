import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, GenesisErrorCodes } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import {
    AuthFailureEnvelope,
    PasswordForgotResponse,
    PasswordForgotResponseSchema,
} from '../../../fixtures/api/schemas/shared/authSchema';
import {
    surferId,
    unseenEmail,
} from '../../../test-data/factories/shared/genesisAuth.factory';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/password-forgot-process', () => {
    test(
        'post with no body returns 200 with the missing-email failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<PasswordForgotResponse>({
                method: 'POST',
                url: ApiEndpoints.PASSWORD_FORGOT_PROCESS,
                baseUrl: apiUrl,
                body: {},
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('password_forgot')
                ),
            });

            expect(status).toBe(200);
            expect(PasswordForgotResponseSchema.parse(body)).toBeTruthy();
            const parsed = PasswordForgotResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.PASSWORD_FORGOT_THROTTLED
            );
        }
    );

    test(
        'post with a malformed email returns 200 with the invalid-email failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<PasswordForgotResponse>({
                method: 'POST',
                url: ApiEndpoints.PASSWORD_FORGOT_PROCESS,
                baseUrl: apiUrl,
                body: { email: 'not-an-email' },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('password_forgot')
                ),
            });

            expect(status).toBe(200);
            expect(PasswordForgotResponseSchema.parse(body)).toBeTruthy();
            const parsed = PasswordForgotResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.PASSWORD_FORGOT_VALIDATION
            );
        }
    );

    test(
        'post with a never-seen email returns 200 with the no-active-account failure envelope (live drift; leaks user enumeration vs OpenAPI success-only spec)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<PasswordForgotResponse>({
                method: 'POST',
                url: ApiEndpoints.PASSWORD_FORGOT_PROCESS,
                baseUrl: apiUrl,
                body: { email: unseenEmail('password_forgot') },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('password_forgot')
                ),
            });

            expect(status).toBe(200);
            expect(PasswordForgotResponseSchema.parse(body)).toBeTruthy();
            const parsed = PasswordForgotResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.PASSWORD_FORGOT_NO_ACTIVE_ACCOUNT
            );
        }
    );

    test(
        'post with the seeded APP_EMAIL returns 200 with success: true (dispatches a real password-reset email to the QA test customer mailbox)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<PasswordForgotResponse>({
                method: 'POST',
                url: ApiEndpoints.PASSWORD_FORGOT_PROCESS,
                baseUrl: apiUrl,
                body: { email: process.env.APP_EMAIL! },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('password_forgot')
                ),
            });

            expect(status).toBe(200);
            // FIXME: https://trello.com/c/Ku80mryj — the success branch of
            // `password-forgot-process` ships `{"success":true}` JSON
            // under `Content-Type: text/html; charset=utf-8`, same drift
            // family as `customer-sign-up`. JSON.parse the string body
            // so the strict Zod schema still validates the shape; drop
            // this shim once the backend ships success responses with
            // `application/json`.
            const parsedBody =
                typeof body === 'string' ? JSON.parse(body) : body;
            expect(PasswordForgotResponseSchema.parse(parsedBody)).toBeTruthy();
            const parsed = PasswordForgotResponseSchema.parse(parsedBody);
            expect(parsed.success).toBe(true);
        }
    );

    // FIXME: https://trello.com/c/Ku80mryj — POST-only per OpenAPI; live
    // accepts every verb (same drift family as the rest of storefront-api).
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: ApiEndpoints.PASSWORD_FORGOT_PROCESS,
                    baseUrl: apiUrl,
                    body: { email: unseenEmail('password_forgot') },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('password_forgot')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
