import { expect, test } from '../../../fixtures/pom/test-options';
import { ApiEndpoints } from '../../../enums/shared/genesis';
import { flighthubConfig } from '../../../config/flighthub';
import { justflyConfig } from '../../../config/justfly';
import {
    GenesisErrorResponse,
    GenesisErrorResponseSchema,
} from '../../../fixtures/api/schemas/util/errorResponseSchema';

/**
 * Smoke spec for the `apiRequest` fixture against the genesis Storefront API.
 *
 * Lives under `tests/shared/api/` so it runs under BOTH `flighthub-chromium`
 * and `justfly-chromium` projects and exercises both `FLIGHTHUB_API_URL` and
 * `JUSTFLY_API_URL`. Uses public endpoints (no `Authorization` header) so the
 * smoke does not depend on `APP_EMAIL` / `APP_PASSWORD` being valid.
 *
 * The deeper response shape lives on the per-endpoint child cards on
 * EPIC https://trello.com/c/2w2qKbK5; this spec only proves end-to-end
 * fixture wiring and the genesis 4xx envelope. The strict
 * `AirportInfoSchema` lands in https://trello.com/c/aqt8sucM (PR #10) and
 * supersedes any inline shape here.
 */

// `playwright.config.ts` loads exactly one of the two brand env files at a
// time, so only the active brand's *_API_URL is defined.
const apiUrl = flighthubConfig.apiUrl ?? justflyConfig.apiUrl!;

interface SmokeAirport {
    code: string;
    raw_code: string;
}
type SmokeAirportsResponse = SmokeAirport[];

test.describe('genesis storefront API smoke', () => {
    test(
        'apiRequest returns 200 and an array body for a public GET',
        { tag: ['@api', '@sanity'] },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<SmokeAirportsResponse>({
                method: 'GET',
                url: `${ApiEndpoints.AIRPORTS_AUTOCOMPLETE}?term=New%20Y`,
                baseUrl: apiUrl,
            });

            expect(status).toBe(200);
            expect(Array.isArray(body)).toBe(true);
            expect(body.length).toBeGreaterThan(0);
            expect(body[0].code.length).toBeGreaterThan(0);
            expect(body[0].code).toBe(body[0].raw_code);
        }
    );

    test(
        'apiRequest returns 404 with the genesis error envelope for an unknown path',
        { tag: '@api' },
        async ({ apiRequest }) => {
            const { status, body } = await apiRequest<GenesisErrorResponse>({
                method: 'GET',
                url: '/storefront-api/__nonexistent_smoke_endpoint__',
                baseUrl: apiUrl,
            });

            expect(status).toBe(404);
            expect(GenesisErrorResponseSchema.parse(body)).toBeTruthy();
            expect(body.error).toBe(true);
            expect(body.error_message.length).toBeGreaterThan(0);
        }
    );
});
