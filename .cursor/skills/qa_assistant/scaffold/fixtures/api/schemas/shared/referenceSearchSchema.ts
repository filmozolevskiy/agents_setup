import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

import { AuthFailureEnvelopeSchema } from './authSchema';

/**
 * Zod schemas for the genesis Storefront API "reference search" 2FA flow
 * (`ref-search-init`, `ref-search-process`).
 *
 * Sourced from the Storefront API OpenAPI spec at
 * `app_source_code/genesis/include/Mv/Ota/Jfly/App/StorefrontApi/openapi.yaml`
 * and verified live against `https://staging2.flighthub.com/storefront-api/...`.
 *
 * Inherits the same drift family as the rest of the storefront API:
 *
 *  - All parameters are documented as `in: query` but the PHP handler
 *    reads them from `$_request->jsonArray` (POST JSON body).
 *  - `surfer_id` is read from the `Surferid` header, not the documented
 *    query param.
 *  - A same-origin `Referer` header is required (CSRF check via
 *    `Mv_Request_Throttler::isValidLoginProcessRequest`).
 *  - All failure cases return 200 with the shared
 *    {@link AuthFailureEnvelopeSchema} envelope, never a 4xx.
 *
 * Endpoint-specific drift on `ref-search-process`:
 *
 *  - The OpenAPI success response declares `{success, hash_id}` but the
 *    handler only sets `{success: true}` — `hash_id` is **never**
 *    returned (`Mv/Ota/Jfly/App/StorefrontApi.php` line 5210). The
 *    success schema below encodes the live shape.
 *  - The OpenAPI `totp` query parameter is documented as `required: true`
 *    but `actionRefSearchProcess` never validates it — the handler
 *    looks the booking up by `id + last_name + site_id` only and returns
 *    `success: true` for any TOTP value. Tracked under
 *    https://trello.com/c/zBkrosRx.
 *
 * All findings are folded into the Content Integration GENESIS bug card
 * follow-up on the EPIC.
 */

// ==================== /storefront-api/ref-search-init ====================

/**
 * `POST /ref-search-init` success response. Live: `{success: true}`.
 * The booking-lookup happy path is `test.skip` until a seeded booking
 * + last-name pair exists on staging2 (https://trello.com/c/zBkrosRx).
 */
export const RefSearchInitSuccessSchema = z.strictObject({
    success: z.literal(true),
});

export const RefSearchInitResponseSchema = z.union([
    RefSearchInitSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== /storefront-api/ref-search-process ====================

/**
 * `POST /ref-search-process` success response — drift from OpenAPI.
 *
 * OpenAPI declares `{success: boolean, hash_id: string}`. Live handler
 * only sets `success: true` (line 5210 of
 * `Mv/Ota/Jfly/App/StorefrontApi.php`); `hash_id` is never returned.
 */
export const RefSearchProcessSuccessSchema = z.strictObject({
    // drift: OpenAPI declares `{success, hash_id}` but the handler only
    //        sets `success: true` (line 5210 of
    //        `Mv/Ota/Jfly/App/StorefrontApi.php`). `hash_id` is never
    //        returned. See https://trello.com/c/zBkrosRx
    success: z.literal(true),
});

export const RefSearchProcessResponseSchema = z.union([
    RefSearchProcessSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== Type exports ====================

export type RefSearchInitSuccess = zOutput<typeof RefSearchInitSuccessSchema>;
export type RefSearchInitResponse = zOutput<typeof RefSearchInitResponseSchema>;

export type RefSearchProcessSuccess = zOutput<
    typeof RefSearchProcessSuccessSchema
>;
export type RefSearchProcessResponse = zOutput<
    typeof RefSearchProcessResponseSchema
>;
