/**
 * Helpers for the genesis Storefront API "auth & account" endpoints.
 *
 * All seven endpoints (`check-email`, `customer-sign-up`, `login-init`,
 * `login-process`, `password-forgot-process`, `resend-totp`,
 * `get-user-details`) require two request headers that the OpenAPI spec
 * does not declare:
 *
 *  - `Surferid` — identifier read by `Mv_Ota_Jfly_App_StorefrontApi::_preAction()`
 *    and used as the throttling / session key. The spec wrongly declares
 *    it as a query parameter (`surfer_id`).
 *  - `Referer` — same-origin URL used by
 *    `Mv_Request_Throttler::isValidLoginProcessRequest()` as a CSRF check.
 *    Without it every request is throttled into the per-endpoint
 *    `*_INVALID_THROTTLE` failure envelope.
 *
 * Both contract violations are tracked under
 * https://trello.com/c/Ku80mryj.
 *
 * Each call to {@link genesisStorefrontAuthHeaders} returns a fresh,
 * unique `Surferid` so individual tests do not collide on the genesis
 * per-surfer throttle state.
 */

import { randomBytes } from 'crypto';

/**
 * Build the request headers required by every genesis Storefront API
 * "auth & account" endpoint.
 *
 * @param appUrl Brand storefront URL (e.g. `https://staging2.flighthub.com`).
 *   Used as the `Referer` value so the genesis throttler accepts the
 *   request as same-origin.
 * @param surferIdPrefix Optional human-readable prefix included in the
 *   generated `Surferid` to make APM traces easier to correlate to a
 *   spec / test (e.g. `'check_email_spec'`). Default `'pwt_shared_api'`.
 * @returns Header map ready to spread into `apiRequest`'s `extraHeaders`.
 */
export function genesisStorefrontAuthHeaders(
    appUrl: string,
    surferIdPrefix = 'pwt_shared_api'
): Record<string, string> {
    return {
        Surferid: `${surferIdPrefix}_${randomBytes(8).toString('hex')}`,
        Referer: appUrl.endsWith('/') ? appUrl : `${appUrl}/`,
    };
}
