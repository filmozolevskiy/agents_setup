import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, GenesisErrorCodes } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import {
    AuthFailureEnvelope,
    LoginInitResponse,
    LoginInitResponseSchema,
    LoginInitSuccessSchema,
} from '../../../fixtures/api/schemas/shared/authSchema';
import {
    surferId,
    unseenEmail,
    validPassword,
} from '../../../test-data/factories/shared/genesisAuth.factory';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/login-init', () => {
    test(
        'post with no body returns 200 with the missing-credentials failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<LoginInitResponse>({
                method: 'POST',
                url: ApiEndpoints.LOGIN_INIT,
                baseUrl: apiUrl,
                body: {},
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('login_init')
                ),
            });

            expect(status).toBe(200);
            expect(LoginInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = LoginInitResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.LOGIN_INIT_THROTTLED
            );
        }
    );

    test(
        'post with a malformed email returns 200 with the invalid-email failure envelope',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<LoginInitResponse>({
                method: 'POST',
                url: ApiEndpoints.LOGIN_INIT,
                baseUrl: apiUrl,
                body: { email: 'not-an-email', password: validPassword() },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('login_init')
                ),
            });

            expect(status).toBe(200);
            expect(LoginInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = LoginInitResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
        }
    );

    test(
        'post with a never-seen email returns 200 with the incorrect-credentials failure envelope (matches the OpenAPI 3000021 path)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<LoginInitResponse>({
                method: 'POST',
                url: ApiEndpoints.LOGIN_INIT,
                baseUrl: apiUrl,
                body: {
                    email: unseenEmail('login_init'),
                    password: validPassword(),
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('login_init')
                ),
            });

            expect(status).toBe(200);
            expect(LoginInitResponseSchema.parse(body)).toBeTruthy();
            const parsed = LoginInitResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.LOGIN_INIT_THROTTLED
            );
        }
    );

    test(
        'post with real APP_EMAIL / APP_PASSWORD returns 200 with success: true and dispatches a TOTP email',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<LoginInitResponse>({
                method: 'POST',
                url: ApiEndpoints.LOGIN_INIT,
                baseUrl: apiUrl,
                body: {
                    email: process.env.APP_EMAIL!,
                    password: process.env.APP_PASSWORD!,
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('login_init_happy')
                ),
            });

            expect(status).toBe(200);
            // Assert with the strict success schema (not the union) so
            // any failure envelope here surfaces as a ZodError instead
            // of silently succeeding via the union branch.
            expect(LoginInitSuccessSchema.parse(body)).toBeTruthy();
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/Ku80mryj — same OpenAPI vs body-field
    // drift family as `check-email` / `customer-sign-up`.
    test.skip(
        'post with documented query params returns 200 with success per OpenAPI (live: failure envelope, body fields ignored)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const params = new URLSearchParams({
                email: unseenEmail('login_init'),
                password: validPassword(),
                surfer_id: surferId('login_init'),
            });
            const { status } = await apiRequest({
                method: 'POST',
                url: `${ApiEndpoints.LOGIN_INIT}?${params.toString()}`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(200);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

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
                    url: ApiEndpoints.LOGIN_INIT,
                    baseUrl: apiUrl,
                    body: {
                        email: unseenEmail('login_init'),
                        password: validPassword(),
                    },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('login_init')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
