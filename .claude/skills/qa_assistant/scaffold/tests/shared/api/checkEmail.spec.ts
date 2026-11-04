import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints, GenesisErrorCodes } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import { genesisStorefrontAuthHeaders } from '../../../helpers/shared/genesisStorefrontAuthHeaders';
import {
    AuthFailureEnvelope,
    CheckEmailResponse,
    CheckEmailResponseSchema,
    CheckEmailSuccess,
} from '../../../fixtures/api/schemas/shared/authSchema';
import {
    surferId,
    unseenEmail,
} from '../../../test-data/factories/shared/genesisAuth.factory';

const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;
const appUrl = flighthubConfig.appUrl ?? justflyConfig.appUrl!;

test.describe('genesis Storefront API — /storefront-api/check-email', () => {
    test(
        'post with a randomly generated never-seen email returns 200 with email_exists: false',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<CheckEmailResponse>({
                method: 'POST',
                url: ApiEndpoints.CHECK_EMAIL,
                baseUrl: apiUrl,
                body: { email: unseenEmail('check_email') },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('check_email')
                ),
            });

            expect(status).toBe(200);
            expect(CheckEmailResponseSchema.parse(body)).toBeTruthy();
            const parsed = CheckEmailResponseSchema.parse(body);
            expect((parsed as CheckEmailSuccess).email_exists).toBe(false);
        }
    );

    test(
        'post with a malformed email returns 200 with the failure envelope (live drift; OpenAPI does not document failure shape)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<CheckEmailResponse>({
                method: 'POST',
                url: ApiEndpoints.CHECK_EMAIL,
                baseUrl: apiUrl,
                body: { email: 'not-an-email' },
                extraHeaders: genesisStorefrontAuthHeaders(
                    appUrl,
                    surferId('check_email')
                ),
            });

            expect(status).toBe(200);
            expect(CheckEmailResponseSchema.parse(body)).toBeTruthy();
            const parsed = CheckEmailResponseSchema.parse(body);
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
            expect((parsed as AuthFailureEnvelope).error_code).toBe(
                GenesisErrorCodes.REFERER_INVALID_THROTTLE
            );
        }
    );

    test(
        'post with no Surferid header returns 200 with a `success: false` failure envelope (live drift; OpenAPI declares surfer_id as a query param)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<CheckEmailResponse>({
                method: 'POST',
                url: ApiEndpoints.CHECK_EMAIL,
                baseUrl: apiUrl,
                body: { email: unseenEmail('check_email') },
                extraHeaders: { Referer: appUrl },
            });

            expect(status).toBe(200);
            expect(CheckEmailResponseSchema.parse(body)).toBeTruthy();
            const parsed = CheckEmailResponseSchema.parse(body);
            // Surferid-less → genesis rejects the call. The exact code
            // (3000000 invalid-request vs 3000002 throttled) depends on
            // whether the genesis throttler has seen this surfer-cookie
            // chain in the same window; assert only `success: false` so
            // the test stays deterministic across CI runs.
            expect((parsed as AuthFailureEnvelope).success).toBe(false);
        }
    );

    /* eslint-disable playwright/no-skipped-test */
    // FIXME: https://trello.com/c/Ku80mryj — OpenAPI declares `email` and
    // `surfer_id` as required QUERY parameters, but the PHP handler reads
    // them from the JSON body (`_request->jsonArray`) and `Surferid`
    // header. A spec-compliant call (GET with query params) returns the
    // failure envelope instead of a 400 / 200 happy-path response.
    test.skip(
        'get with documented query params returns 200 with email_exists per OpenAPI (live: 200 with failure envelope, body fields ignored)',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const params = new URLSearchParams({
                email: unseenEmail('check_email'),
                surfer_id: surferId('check_email'),
            });
            const { status } = await apiRequest({
                method: 'GET',
                url: `${ApiEndpoints.CHECK_EMAIL}?${params.toString()}`,
                baseUrl: apiUrl,
            });
            expect(status).toBe(200);
        }
    );
    /* eslint-enable playwright/no-skipped-test */

    // FIXME: https://trello.com/c/Ku80mryj — OpenAPI declares POST only.
    // Live ignores HTTP verb routing on storefront-api endpoints (same
    // family as airports / search-context / search-flow drift).
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH'] as const) {
        /* eslint-disable playwright/no-skipped-test */
        test.skip(
            `${method} returns 405 (OpenAPI contract; live ignores HTTP verb)`,
            { tag: '@api' },
            async ({ apiRequest }) => {
                const { status } = await apiRequest({
                    method,
                    url: ApiEndpoints.CHECK_EMAIL,
                    baseUrl: apiUrl,
                    body: { email: unseenEmail('check_email') },
                    extraHeaders: genesisStorefrontAuthHeaders(
                        appUrl,
                        surferId('check_email')
                    ),
                });
                expect(status).toBe(405);
            }
        );
        /* eslint-enable playwright/no-skipped-test */
    }
});
