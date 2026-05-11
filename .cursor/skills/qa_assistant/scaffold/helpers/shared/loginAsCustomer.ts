/**
 * End-to-end login helper for the genesis Storefront API auth chain.
 *
 * Drives the full `login-init` → read TOTP secret from MySQL →
 * compute TOTP → `login-process` flow and returns the session JWT
 * plus the customer fields the response carries (`email`,
 * `first_name`, `last_name`).
 *
 * The same `Surferid` is reused across both calls so the genesis
 * throttler treats them as one logical login session — unlike a fresh
 * call to {@link genesisStorefrontAuthHeaders} per step, which would
 * mint a new `Surferid` each time.
 *
 * Side effect: a successful `login-process` causes genesis to rotate
 * the customer's TOTP secret via `Mv_Ota_Customer_2FA::reset()`. The
 * helper does not need to refresh anything afterwards (the next call
 * will simply re-read the new secret), but tests that call this in
 * tight loops should be aware their first failure may correspond to
 * a code that was valid 600s ago but is no longer.
 */

import { ApiRequestFn } from '../../fixtures/api/api-types';
import { ApiEndpoints } from '../../enums/shared/genesis';
import { flighthubConfig } from '../../config/flighthub';
import { justflyConfig } from '../../config/justfly';
import {
    LoginInitResponse,
    LoginInitSuccessSchema,
    LoginProcessResponse,
    LoginProcessSuccessSchema,
} from '../../fixtures/api/schemas/shared/authSchema';
import { genesisStorefrontAuthHeaders } from './genesisStorefrontAuthHeaders';
import { totpForCustomer, type Brand } from './genesisTotp';

export type LoginAsCustomerResult = {
    token: string;
    email: string;
    first_name: string;
    last_name: string;
};

export type LoginAsCustomerOptions = {
    apiRequest: ApiRequestFn;
    /** Defaults to `process.env.APP_EMAIL`. */
    email?: string;
    /** Defaults to `process.env.APP_PASSWORD`. */
    password?: string;
    /** Defaults to `process.env.BRAND`. */
    brand?: Brand;
};

/**
 * Maximum number of full init → TOTP → process attempts before giving
 * up. A retry is needed when another concurrent test rotates the
 * customer's secret between our `totpForCustomer` read and our
 * `login-process` POST — the read-then-rotate race window is small
 * but real under `fullyParallel: true` when several specs share the
 * same `APP_EMAIL`. Two attempts cover the common 2-test collision;
 * three covers the 3-test pile-up; beyond that something else is
 * wrong (auth pool exhausted, throttler engaged, secret deleted).
 */
const MAX_LOGIN_ATTEMPTS = 3;

/** Genesis error_code returned for "TOTP wrong or expired" — the symptom of a secret-rotation race. */
const ERROR_CODE_TOTP_INVALID = 3000025;

/**
 * Drive the full genesis Storefront login flow and return the JWT.
 *
 * Resilient to a concurrent test rotating the customer's TOTP secret
 * mid-flight: on a `3000025` failure (TOTP invalid / expired) the
 * helper re-runs the full chain up to {@link MAX_LOGIN_ATTEMPTS}
 * times. The re-run reads a fresh secret from MySQL each attempt, so
 * a winning concurrent test that already rotated the secret simply
 * costs us one extra round-trip rather than a false-positive failure.
 *
 * @returns The genesis JWT + customer name/email fields per
 *   `LoginProcessSuccessSchema`. Pass `result.token` to
 *   `apiRequest`'s `headers` parameter (the fixture wraps it as
 *   `Authorization: Bearer <token>`).
 * @throws If `login-init` does not return `{success: true}`, the
 *   MySQL secret lookup fails, or `login-process` keeps returning the
 *   failure envelope after {@link MAX_LOGIN_ATTEMPTS}.
 */
export async function loginAsCustomer(
    options: LoginAsCustomerOptions
): Promise<LoginAsCustomerResult> {
    const {
        apiRequest,
        email = process.env.APP_EMAIL!,
        password = process.env.APP_PASSWORD!,
        brand = (process.env.BRAND as Brand | undefined) ?? 'flighthub',
    } = options;

    const apiUrl = (
        brand === 'flighthub' ? flighthubConfig.apiUrl : justflyConfig.apiUrl
    )!;
    const appUrl = (
        brand === 'flighthub' ? flighthubConfig.appUrl : justflyConfig.appUrl
    )!;

    let lastFailure = '';
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
        const headers = genesisStorefrontAuthHeaders(appUrl, 'pwt_login_as');

        const init = await apiRequest<LoginInitResponse>({
            method: 'POST',
            url: ApiEndpoints.LOGIN_INIT,
            baseUrl: apiUrl,
            body: { email, password },
            extraHeaders: headers,
        });
        if (init.status !== 200) {
            throw new Error(
                `loginAsCustomer: login-init returned status ${init.status} on attempt ${attempt} (expected 200)`
            );
        }
        LoginInitSuccessSchema.parse(init.body);

        const totp = await totpForCustomer(email, brand);

        const proc = await apiRequest<LoginProcessResponse>({
            method: 'POST',
            url: ApiEndpoints.LOGIN_PROCESS,
            baseUrl: apiUrl,
            body: { email, password, totp },
            extraHeaders: headers,
        });

        const successParse = LoginProcessSuccessSchema.safeParse(proc.body);
        if (proc.status === 200 && successParse.success) {
            const success = successParse.data;
            return {
                token: success.token,
                email: success.email,
                first_name: success.first_name,
                last_name: success.last_name,
            };
        }

        const failureBody = proc.body as
            | { success?: boolean; error_code?: number; error_message?: string }
            | undefined;
        lastFailure = `attempt ${attempt}: status=${proc.status} body=${JSON.stringify(failureBody).slice(0, 240)}`;

        if (failureBody?.error_code !== ERROR_CODE_TOTP_INVALID) {
            throw new Error(
                `loginAsCustomer: login-process failed with non-retryable response — ${lastFailure}`
            );
        }
    }

    throw new Error(
        `loginAsCustomer: exhausted ${MAX_LOGIN_ATTEMPTS} attempts; last response: ${lastFailure}`
    );
}
