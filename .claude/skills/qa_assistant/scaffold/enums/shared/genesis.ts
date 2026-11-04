/**
 * Shared `genesis` backend constants.
 *
 * Flighthub and JustFly run on the same `genesis` PHP backend, so API endpoint
 * paths and shared error message bodies live here and are imported from both
 * brand areas. Anything that is genuinely brand-agnostic (endpoint paths,
 * shared response messages) belongs in this file.
 *
 * For brand-specific UI strings, see `enums/flighthub/flighthub.ts` and
 * `enums/justfly/justfly.ts`. For roles, see `enums/util/roles.ts`.
 */

/**
 * Genesis Storefront API endpoint paths (shared across both brands).
 *
 * Sourced from the `Storefront API` OpenAPI spec at
 * `app_source_code/genesis/include/Mv/Ota/Jfly/App/StorefrontApi/openapi.yaml`
 * (read-only AI context per the `reference-source-code` skill — values are
 * encoded here as the canonical source of truth for the scaffold).
 *
 * Path stems only: endpoints with `{path}` segments (e.g. `/region-select/{country_code}`)
 * are templated in test code by appending the dynamic part to the stem
 * (e.g. ``url: `${ApiEndpoints.REGION_SELECT}/${countryCode}` ``).
 */
export enum ApiEndpoints {
    AIRPORTS_AUTOCOMPLETE = '/storefront-api/airports-autocomplete',
    AIRPORTS_NEARBY = '/storefront-api/airports-nearby',
    DATE_PICKER_PRICES = '/storefront-api/date-picker-prices',
    REGION_SELECT = '/storefront-api/region-select',
    PAST_SEARCHES = '/storefront-api/past-searches',
    TOP_DEALS = '/storefront-api/top-deals',
    SEARCH_INIT = '/storefront-api/search-init',
    SEARCH_RESULT_FETCH = '/storefront-api/search-result-fetch',
    GET_TAX_BREAKDOWN = '/storefront-api/get-tax-breakdown',
    CHECK_AVAILABILITY = '/storefront-api/check-availability',
    GET_AEROPLANS = '/storefront-api/get-aeroplans',
    GET_USER_DETAILS = '/storefront-api/get-user-details',
    CHECK_EMAIL = '/storefront-api/check-email',
    CUSTOMER_SIGN_UP = '/storefront-api/customer-sign-up',
    LOGIN_INIT = '/storefront-api/login-init',
    LOGIN_PROCESS = '/storefront-api/login-process',
    REF_SEARCH_INIT = '/storefront-api/ref-search-init',
    REF_SEARCH_PROCESS = '/storefront-api/ref-search-process',
    PASSWORD_FORGOT_PROCESS = '/storefront-api/password-forgot-process',
    RESEND_TOTP = '/storefront-api/resend-totp',
}

/**
 * Genesis Storefront API error codes returned in the
 * `{success: false, error_code, error_message, error_details}` failure
 * envelope. Captured live; not all codes are documented in the OpenAPI
 * spec. Add entries here as new endpoints surface them.
 */
export enum GenesisErrorCodes {
    INVALID_REQUEST = 3000000,
    REFERER_INVALID_THROTTLE = 3000001,
    REFERER_THROTTLED = 3000002,
    LOGIN_INIT_THROTTLED = 3000021,
    REF_SEARCH_INIT_MISSING_FIELDS = 3000031,
    REF_SEARCH_INIT_BOOKING_NOT_FOUND = 3000033,
    REF_SEARCH_PROCESS_NOT_FOUND = 3000042,
    PASSWORD_FORGOT_THROTTLED = 3000053,
    PASSWORD_FORGOT_VALIDATION = 3000054,
    PASSWORD_FORGOT_NO_ACTIVE_ACCOUNT = 3000056,
    RESEND_TOTP_THROTTLED = 3000062,
    PACKAGE_NOT_FOUND = 2000002,
}

/**
 * Genesis Storefront API human-readable error messages.
 *
 * Used in assertions on the failure-envelope `error_message` field so the
 * spec stays the single source of truth (per the constitution's "Sources
 * of Truth" rule). Captured live and confirmed verbatim.
 */
export enum Messages {
    PACKAGE_NOT_FOUND = 'Package not found',
    NO_ACTIVE_ACCOUNT_ASSOCIATED_WITH_THIS_EMAIL = 'No active account associated with this email',
}
