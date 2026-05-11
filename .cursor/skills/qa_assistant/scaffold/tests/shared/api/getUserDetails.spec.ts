import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import { loginAsCustomer } from '../../../helpers/shared/loginAsCustomer';
import {
    GetUserDetailsResponse,
    GetUserDetailsResponseSchema,
    GetUserDetailsSuccessSchema,
} from '../../../fixtures/api/schemas/shared/authSchema';
import { surferId } from '../../../test-data/factories/shared/genesisAuth.factory';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/get-user-details', () => {
    test(
        'get without an Authorization header returns 200 with an empty array (live drift; OpenAPI does not document this branch — should be 401)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<GetUserDetailsResponse>({
                method: 'GET',
                url: ApiEndpoints.GET_USER_DETAILS,
                baseUrl: apiUrl,
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('get_user_details')
                ),
            });

            expect(status).toBe(200);
            expect(GetUserDetailsResponseSchema.parse(body)).toBeTruthy();
            const parsed = GetUserDetailsResponseSchema.parse(body);

            expect(Array.isArray(parsed) ? parsed.length : -1).toBe(0);
        }
    );

    test(
        'get with a syntactically valid but unknown Bearer token returns 200 with an empty array (live drift; should be 401 / 403)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<GetUserDetailsResponse>({
                method: 'GET',
                url: ApiEndpoints.GET_USER_DETAILS,
                baseUrl: apiUrl,
                headers: 'pwt-not-a-real-jwt-token',
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('get_user_details')
                ),
            });

            expect(status).toBe(200);
            expect(GetUserDetailsResponseSchema.parse(body)).toBeTruthy();
            const parsed = GetUserDetailsResponseSchema.parse(body);

            expect(Array.isArray(parsed) ? parsed.length : -1).toBe(0);
        }
    );

    test(
        'get with a valid Bearer token returns 200 with the GetUserDetailsSuccessSchema',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { token } =
                await test.step('log in via login-init -> TOTP-from-MySQL -> login-process to obtain a fresh JWT', async () =>
                    loginAsCustomer({ apiRequest }));

            await test.step('get-user-details with the JWT returns the customer profile fields', async () => {
                const { status, body } =
                    await apiRequest<GetUserDetailsResponse>({
                        method: 'GET',
                        url: ApiEndpoints.GET_USER_DETAILS,
                        baseUrl: apiUrl,
                        headers: token,
                        extraHeaders: genesisStorefrontAuthHeaders(
                            appUrl,
                            surferId('get_user_details_happy')
                        ),
                    });

                expect(status).toBe(200);
                expect(GetUserDetailsSuccessSchema.parse(body)).toBeTruthy();
                const parsed = GetUserDetailsSuccessSchema.parse(body);
                expect(parsed.email).toBe(process.env.APP_EMAIL);
                expect(parsed.first_name.length).toBeGreaterThan(0);
                expect(parsed.last_name.length).toBeGreaterThan(0);
            });
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/Ku80mryj — OpenAPI implies a 401 for
    // a missing / invalid Bearer token. Live silently returns 200 + [].
    test.skip(
        'get without an Authorization header returns 401 (OpenAPI implied contract; live returns 200 [])',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status } = await apiRequest({
                method: 'GET',
                url: ApiEndpoints.GET_USER_DETAILS,
                baseUrl: apiUrl,
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('get_user_details')
                ),
            });
            expect(status).toBe(401);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/Ku80mryj — GET-only per OpenAPI; live
    // accepts every verb (same drift family as the rest of storefront-api).
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: ApiEndpoints.GET_USER_DETAILS,
                    baseUrl: apiUrl,
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('get_user_details')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
