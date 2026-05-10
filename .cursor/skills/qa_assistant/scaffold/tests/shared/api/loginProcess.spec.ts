import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import { loginAsCustomer } from '../../../helpers/shared/loginAsCustomer';
import {
    LoginProcessResponse,
    LoginProcessResponseSchema,
} from '../../../fixtures/api/schemas/shared/authSchema';
import {
    surferId,
    unseenEmail,
    validPassword,
    validTotp,
} from '../../../test-data/factories/shared/genesisAuth.factory';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/login-process', () => {
    // Active reproducer for the 500 PHP-stack-trace leak. Asserts only the
    // status code so the test stays robust to any change in the backend log
    // format — the symptom we want flagged is "this returns 500 instead of
    // a `success: false` failure envelope", not the specific shape of the
    // leaked stack trace. When the backend bug is fixed, status will become
    // 200 and this test will fail — that is the desired signal to flip it
    // back to a normal failure-envelope test.
    test(
        'post with a never-seen email + a stub TOTP actually returns 500 (active reproducer for the backend bug)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'POST',
                url: ApiEndpoints.LOGIN_PROCESS,
                baseUrl: apiUrl,
                body: {
                    email: unseenEmail('login_process'),
                    password: validPassword(),
                    totp: validTotp(),
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('login_process')
                ),
            });

            expect(status).toBe(500);
        }
    );

    test(
        'init -> capture TOTP from MySQL -> process chain returns 200 with a JWT token',
        { tag: '@api' },
        async ({ apiRequest }) => {
            // Use loginAsCustomer (init → MySQL TOTP → process chain) so this
            // test inherits the helper's secret-rotation retry. login-process
            // rotates customer_2fa.secret on every success, so when this spec
            // runs in parallel with other login-consumers (e.g.
            // get-user-details) the read-then-rotate window can otherwise
            // turn a green flow into a 3000025 false positive.
            const result = await loginAsCustomer({ apiRequest });

            expect(result.token.length).toBeGreaterThan(0);
            expect(result.email).toBe(process.env.APP_EMAIL);
        }
    );

    test(
        'post with real creds + a wrong TOTP returns 200 with the invalid-TOTP failure envelope (3000025)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<LoginProcessResponse>({
                method: 'POST',
                url: ApiEndpoints.LOGIN_PROCESS,
                baseUrl: apiUrl,
                body: {
                    email: process.env.APP_EMAIL!,
                    password: process.env.APP_PASSWORD!,
                    totp: '000000',
                },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('login_process_wrong_totp')
                ),
            });

            expect(status).toBe(200);
            expect(LoginProcessResponseSchema.parse(body)).toBeTruthy();
            expect(
                (body as { success?: boolean; error_code?: number }).success
            ).toBe(false);
            expect(
                (body as { success?: boolean; error_code?: number }).error_code
            ).toBe(3000025);
        }
    );

    /* eslint-disable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/Ku80mryj — same OpenAPI vs body-field
    // drift family as `check-email` / `login-init`.
    test.skip(
        'post with documented query params returns 200 per OpenAPI (live: handler crashes / failure envelope, body fields ignored)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const params = new URLSearchParams({
                email: unseenEmail('login_process'),
                password: validPassword(),
                totp: validTotp(),
                surfer_id: surferId('login_process'),
            });
            const { status } = await apiRequest({
                method: 'POST',
                url: `${ApiEndpoints.LOGIN_PROCESS}?${params.toString()}`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(200);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/Ku80mryj — POST-only per OpenAPI; live
    // accepts every verb. Body intentionally unset so the alternate
    // verbs do not also trip the 500 PHP TypeError; the active
    // reproducer above already covers that.
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: ApiEndpoints.LOGIN_PROCESS,
                    baseUrl: apiUrl,
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('login_process')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
