import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Zod schemas for the genesis Storefront API "auth & account" endpoints
 * (check-email, customer-sign-up, login-init, login-process,
 * password-forgot-process, resend-totp, get-user-details).
 *
 * Sourced from the Storefront API OpenAPI spec at
 * `app_source_code/genesis/include/Mv/Ota/Jfly/App/StorefrontApi/openapi.yaml`
 * and verified live against `https://staging2.flighthub.com/storefront-api/...`.
 *
 * Live behaviour diverges from the spec on every endpoint here in the same
 * three ways (all tracked under https://trello.com/c/Ku80mryj for the
 * consolidated GENESIS bug write-up on the Content Integration board):
 *
 *  1. The OpenAPI spec declares all parameters as `in: query`. The PHP
 *     handlers actually read every field from `$_request->jsonArray`
 *     (POST JSON body) — query params are ignored.
 *  2. `surfer_id` is documented as a query parameter but the handler reads
 *     it from the `Surferid` request header. Without it, every endpoint
 *     short-circuits with `{success: false, error_code: 3000000,
 *     error_message: "Invalid request"}`.
 *  3. A same-origin `Referer` header is required (CSRF check via
 *     `Mv_Request_Throttler::isValidLoginProcessRequest`). Without it the
 *     request is throttled and falls into a per-endpoint
 *     `*_INVALID_THROTTLE` error envelope.
 *
 * Validation failures and not-found cases also return 200 with the
 * `{success: false, error_code, error_message, error_details}` envelope
 * instead of any 4xx code.
 */

// ==================== Common envelope ====================

/**
 * Genesis Storefront API soft-failure envelope used by every auth endpoint
 * for validation, throttle, missing-field and not-found errors. All such
 * failures come back with HTTP 200 — the contract violation vs the
 * OpenAPI spec is captured per-endpoint in the spec files via
 * `test.skip` + `// FIXME`.
 */
export const AuthFailureEnvelopeSchema = z.strictObject({
    success: z.literal(false),
    error_code: z.number().int(),
    error_message: z.string(),
    // FIXME: https://trello.com/c/sQ8M7w9e — `error_details` has been
    //        consistently `[]` across every captured failure: per
    //        2026-05-07 recon, none of the storefront-api auth endpoints
    //        log to MongoDB `ota.debug_logs` (see db-docs/mongodb/
    //        debug_logs.md), and a 9-input fuzz pass against
    //        `customer-sign-up` / `login-init` / `login-process` /
    //        `password-forgot-process` returned `error_details: []`
    //        every time (the genesis handler short-circuits on the
    //        first failed validator). Schema stays open as
    //        `z.array(z.unknown())` until a triggerable non-empty case
    //        surfaces in the wild.
    error_details: z.array(z.unknown()),
});

// ==================== /storefront-api/check-email ====================

/**
 * `POST /check-email` success response.
 *
 * Returned when `Surferid` + same-origin `Referer` are present and the
 * JSON body contains a syntactically valid email. `email_exists` is
 * `true` when an active customer matches, `false` otherwise.
 */
export const CheckEmailSuccessSchema = z.strictObject({
    email_exists: z.boolean(),
});

export const CheckEmailResponseSchema = z.union([
    CheckEmailSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== /storefront-api/customer-sign-up ====================

/**
 * `POST /customer-sign-up` success response (per OpenAPI: `{success: true}`).
 * Failure path returns `AuthFailureEnvelopeSchema`. Not exercised live
 * in this card — sign-up is destructive and there is no DELETE-customer
 * endpoint to clean up the seeded user; tracked as a follow-up on
 * https://trello.com/c/Ku80mryj.
 */
export const CustomerSignUpSuccessSchema = z.strictObject({
    success: z.literal(true),
});

export const CustomerSignUpResponseSchema = z.union([
    CustomerSignUpSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== /storefront-api/login-init ====================

/**
 * `POST /login-init` success response.
 *
 * The handler returns the bare `{success: true}` shape on a successful
 * credentials check + TOTP-email send. The happy path is exercised in
 * `loginInit.spec.ts` against the real `APP_EMAIL` / `APP_PASSWORD`
 * shared genesis test customer (env/.env.shared) — TOTP email dispatch
 * is a side effect we don't observe in that test (the
 * loginProcess.spec.ts chain reads the TOTP from MongoDB to drive the
 * `login-process` happy path).
 */
export const LoginInitSuccessSchema = z.strictObject({
    success: z.literal(true),
});

export const LoginInitResponseSchema = z.union([
    LoginInitSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== /storefront-api/login-process ====================

/**
 * `POST /login-process` success response (per OpenAPI). The B2B fields
 * (`partner`, `campaignId`, `company_id`, `company_name`,
 * `allowed_domain_name`) are only populated for partner accounts, so
 * each is nullable / optional pending a confirmed partner-account
 * fixture. The response is also augmented at runtime with `email`,
 * `first_name`, `last_name` from the auth user (lines 5016-5018 of
 * `Mv/Ota/Jfly/App/StorefrontApi.php`) — that detail is not in the
 * OpenAPI spec but is encoded here.
 *
 * The happy path cannot be exercised in this card without (a) real
 * `APP_EMAIL` / `APP_PASSWORD` and (b) a side-channel for the 2FA TOTP
 * code; tracked as a `test.skip` + `// FIXME:` in `loginProcess.spec.ts`.
 */
export const LoginProcessSuccessSchema = z.strictObject({
    success: z.literal(true),
    email: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    token: z.string(),
    partner: z.boolean().optional(),
    campaignId: z.number().int().optional(),
    company_id: z.number().int().optional(),
    company_name: z.string().optional(),
    allowed_domain_name: z.string().optional(),
});

export const LoginProcessResponseSchema = z.union([
    LoginProcessSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== /storefront-api/password-forgot-process ====================

/**
 * `POST /password-forgot-process` success response (per OpenAPI:
 * `{success: true}`). For a non-existent email the handler returns
 * `{success: false, error_code: 3000056,
 * error_message: "No active account associated with this email"}` —
 * which leaks user enumeration vs the OpenAPI shape and is tracked as
 * a GENESIS bug under https://trello.com/c/Ku80mryj.
 */
export const PasswordForgotSuccessSchema = z.strictObject({
    success: z.literal(true),
});

export const PasswordForgotResponseSchema = z.union([
    PasswordForgotSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== /storefront-api/resend-totp ====================

/**
 * `POST /resend-totp` success response (`{success: true}`). The handler
 * accepts either `{booking_id, last_name}` (for the ref-search flow) or
 * `{email}` (for the login flow); only `surfer_id` is OpenAPI-required.
 * Live with `{email}` returns success even for a non-existent email —
 * the handler does not check whether an active customer exists before
 * calling `sendTOTPEmail`. Tracked under https://trello.com/c/Ku80mryj.
 */
export const ResendTotpSuccessSchema = z.strictObject({
    success: z.literal(true),
});

export const ResendTotpResponseSchema = z.union([
    ResendTotpSuccessSchema,
    AuthFailureEnvelopeSchema,
]);

// ==================== /storefront-api/get-user-details ====================

/**
 * `GET /get-user-details` success response — only returned when the
 * `Authorization: Bearer <token>` header carries a valid genesis JWT.
 *
 * Live drift: when the header is missing or invalid, the handler does
 * NOT return 401 (per OpenAPI). Instead it returns an empty array `[]`
 * with HTTP 200 — the controller leaves `$this->response` empty and
 * Solar serializes the empty associative array as `[]`. Tracked under
 * https://trello.com/c/Ku80mryj.
 */
export const GetUserDetailsSuccessSchema = z.strictObject({
    email: z.string(),
    first_name: z.string(),
    last_name: z.string(),
});

/**
 * Empty-response shape returned by `get-user-details` when auth is
 * missing or invalid (instead of the OpenAPI-spec'd 401). Live: `[]`.
 */
export const GetUserDetailsEmptySchema = z.array(z.never()).max(0);

export const GetUserDetailsResponseSchema = z.union([
    GetUserDetailsSuccessSchema,
    GetUserDetailsEmptySchema,
]);

// ==================== Type exports ====================

export type AuthFailureEnvelope = zOutput<typeof AuthFailureEnvelopeSchema>;

export type CheckEmailSuccess = zOutput<typeof CheckEmailSuccessSchema>;
export type CheckEmailResponse = zOutput<typeof CheckEmailResponseSchema>;

export type CustomerSignUpSuccess = zOutput<typeof CustomerSignUpSuccessSchema>;
export type CustomerSignUpResponse = zOutput<
    typeof CustomerSignUpResponseSchema
>;

export type LoginInitSuccess = zOutput<typeof LoginInitSuccessSchema>;
export type LoginInitResponse = zOutput<typeof LoginInitResponseSchema>;

export type LoginProcessSuccess = zOutput<typeof LoginProcessSuccessSchema>;
export type LoginProcessResponse = zOutput<typeof LoginProcessResponseSchema>;

export type PasswordForgotSuccess = zOutput<typeof PasswordForgotSuccessSchema>;
export type PasswordForgotResponse = zOutput<
    typeof PasswordForgotResponseSchema
>;

export type ResendTotpSuccess = zOutput<typeof ResendTotpSuccessSchema>;
export type ResendTotpResponse = zOutput<typeof ResendTotpResponseSchema>;

export type GetUserDetailsSuccess = zOutput<typeof GetUserDetailsSuccessSchema>;
export type GetUserDetailsEmpty = zOutput<typeof GetUserDetailsEmptySchema>;
export type GetUserDetailsResponse = zOutput<
    typeof GetUserDetailsResponseSchema
>;
