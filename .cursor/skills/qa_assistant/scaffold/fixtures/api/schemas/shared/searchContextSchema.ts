import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Zod schemas for the genesis Storefront API "search-context" endpoints
 * (date-picker-prices, region-select, top-deals, past-searches, get-aeroplans).
 *
 * Sourced from the Storefront API OpenAPI spec at
 * `app_source_code/genesis/include/Mv/Ota/Jfly/App/StorefrontApi/openapi.yaml`
 * and verified live against `https://staging2.flighthub.com/storefront-api/...`.
 *
 * Drift is encoded into the schema (rather than relaxed away) so the strict
 * shape stays aligned with reality. Tracked on https://trello.com/c/KPfxrKkX.
 */

// ==================== /storefront-api/date-picker-prices ====================

/**
 * Per-date price tier on `/date-picker-prices`.
 *
 * OpenAPI lists the enum as `[low, medium, high]` but the live API returns
 * `[low, avg, high]` for `prices.<date>.tier` while still using `medium` for
 * the matrix bucket below. Drift tracked on https://trello.com/c/KPfxrKkX;
 * schema follows live behaviour.
 */
export const DatePickerPriceTierSchema = z.enum([
    'low',
    // drift: OpenAPI says 'medium', live API returns 'avg' for prices.<date>.tier.
    //        See https://trello.com/c/KPfxrKkX
    'avg',
    'high',
]);

export const DatePickerPriceEntrySchema = z.strictObject({
    price: z.number(),
    tier: DatePickerPriceTierSchema,
});

export const DatePickerMatrixSchema = z.strictObject({
    low: z.number(),
    medium: z.number(),
    high: z.number(),
});

/**
 * Success payload (200 with `success: true`).
 * Captured live from `GET /date-picker-prices/YUL/JFK/roundtrip`.
 *
 * Note `currency` is lowercase (`cad`) — OpenAPI spec's
 * `CurrencyCode` insists on uppercase but live API does not honour it
 * (drift tracked on https://trello.com/c/KPfxrKkX).
 */
// Live keys are ISO dates (`YYYY-MM-DD`) per `GET /date-picker-prices/.../roundtrip`.
const DatePickerDateKeySchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD');

export const DatePickerPricesSuccessSchema = z.strictObject({
    data: z.strictObject({
        version: z.number().int(),
        prices: z.record(DatePickerDateKeySchema, DatePickerPriceEntrySchema),
        matrix: DatePickerMatrixSchema,
        // drift: OpenAPI's CurrencyCode demands uppercase ISO-4217; live
        //        returns lowercase ('cad'). See https://trello.com/c/KPfxrKkX
        currency: z.string(),
        currencySymbol: z.string().max(1),
    }),
    success: z.literal(true),
});

/**
 * Failure payload (200 with `success: false` — the live API does NOT use 4xx
 * status codes for invalid inputs on this endpoint; tracked on
 * https://trello.com/c/KPfxrKkX). Captured live with both `trip_type=foobar`
 * and `departure_code=ZZZ` (returns `reason: "invalid_params"` /
 * `reason: "not_found"` respectively).
 */
export const DatePickerPricesFailureSchema = z.strictObject({
    success: z.literal(false),
    reason: z.string(),
});

export const DatePickerPricesResponseSchema = z.union([
    DatePickerPricesSuccessSchema,
    DatePickerPricesFailureSchema,
]);

// ==================== /storefront-api/region-select ====================

/**
 * Live shape: a JSON object map of `region_code -> region_name` for a known
 * `country_code`, e.g. `{"AB":"Alberta","BC":"British Columbia",...}`. For an
 * unknown country code the live API returns `[]` (empty array, not empty
 * object) — the same array-vs-object inconsistency seen on `airports-nearby`,
 * tracked on https://trello.com/c/KPfxrKkX.
 */
// Live keys are ISO 3166-2 subdivision codes (the part after the country
// dash), e.g. Canadian provinces "AB"/"BC"/"ON". Format varies by country
// (most are 2 uppercase letters, some use 1-3 uppercase alphanumerics).
// Loose-but-non-empty regex; tighten further only if a live drift surfaces.
const RegionCodeKeySchema = z
    .string()
    .regex(
        /^[A-Z0-9]{1,3}$/,
        'ISO 3166-2 subdivision suffix (uppercase 1-3 chars)'
    );

export const RegionSelectResponseSchema = z.union([
    z.record(RegionCodeKeySchema, z.string()),
    // drift: OpenAPI says the response is always a region map; live API
    //        returns `[]` (empty array, not empty object) for unknown
    //        country codes. See https://trello.com/c/KPfxrKkX
    z.array(z.never()).max(0),
]);

// ==================== /storefront-api/top-deals ====================

/**
 * Single top-deal entry returned by `GET /top-deals/{departingCityCode}`.
 *
 * The OpenAPI spec points at the shared `FlightSearchPayload` component but
 * the live response (captured against `GET /top-deals/YUL`) has its own
 * shape with 12 fields and a nested `search_params` object — none of the
 * `FlightSearchPayload` fields (`from_date`, `to_date`, `currency`, `price`,
 * `from_code`, `to_code`, `from`, `to`, `search_params`) match the shape
 * exactly. Drift tracked on https://trello.com/c/KPfxrKkX; schema below
 * encodes the live shape.
 */
export const TopDealSearchParamsSchema = z.strictObject({
    seg0_from: z.string(),
    seg0_to: z.string(),
    seg1_to: z.string(),
    seg1_from: z.string(),
    seg0_date: z.string(),
    seg1_date: z.string(),
    order_by: z.string(),
    currency: z.string(),
    num_adults: z.number().int(),
    num_children: z.number().int(),
    num_infants: z.number().int(),
    num_infants_lap: z.number().int(),
    type: z.string(),
    seat_class: z.string(),
});

// drift: OpenAPI references the shared FlightSearchPayload component; live
//        response has its own 12-field shape with a nested search_params
//        object. None of FlightSearchPayload's fields match exactly. See
//        https://trello.com/c/KPfxrKkX
export const TopDealItemSchema = z.strictObject({
    from: z.string(),
    to: z.string(),
    country: z.string(),
    from_code: z.string(),
    to_code: z.string(),
    to_banner: z.string(),
    from_date: z.string(),
    to_date: z.string(),
    price: z.number(),
    currency: z.string(),
    search_params: TopDealSearchParamsSchema,
    date_added: z.string(),
});

export const TopDealsResponseSchema = z.array(TopDealItemSchema);

// ==================== /storefront-api/past-searches ====================

/**
 * `search_params` sub-object on each `past-searches` item — captured live
 * by seeding via `search-init` with a known short surfer_id (≤ 32 chars)
 * and then immediately querying `past-searches/{surfer_id}`.
 *
 * Drift to flag (all under https://trello.com/c/KPfxrKkX):
 *
 *  - Numeric fields (`num_adults`, `num_children`, etc.) come back as
 *    JSON strings ("1", "0"), not numbers. OpenAPI's
 *    `FlightSearchPayload.num_adults: integer` is wrong about the type.
 *  - `seat_class` is free-form here too (search-init does not enforce
 *    the [Economy, EconomyPremium, Business, First] enum, so whatever
 *    arbitrary value was passed gets echoed back).
 *  - `seg1_*` fields are present only for roundtrip / multi searches —
 *    OpenAPI omits the per-segment shape entirely (only documents
 *    `seg0_*`).
 */
export const PastSearchSearchParamsSchema = z.strictObject({
    // drift: stringified numbers (live), OpenAPI says integer.
    //        See https://trello.com/c/KPfxrKkX
    num_adults: z.string(),
    num_children: z.string(),
    num_infants: z.string(),
    num_infants_lap: z.string(),
    // drift: free-form string, OpenAPI declares enum
    //        [Economy, EconomyPremium, Business, First].
    //        See https://trello.com/c/KPfxrKkX
    seat_class: z.string(),
    seg0_date: z.string(),
    seg0_from: z.string(),
    seg0_to: z.string(),
    type: z.string(),
    language: z.string(),
    currency: z.string(),
    seg0_from_city: z.string(),
    seg0_from_airport_name: z.string(),
    seg0_to_city: z.string(),
    seg0_to_airport_name: z.string(),
    // Optional — only present for roundtrip / multi-segment searches.
    seg1_date: z.string().optional(),
    seg1_from: z.string().optional(),
    seg1_to: z.string().optional(),
    seg1_from_city: z.string().optional(),
    seg1_from_airport_name: z.string().optional(),
    seg1_to_city: z.string().optional(),
    seg1_to_airport_name: z.string().optional(),
});

/**
 * Single item in the `past-searches/{surferId}` response array.
 *
 * Drift to flag (under https://trello.com/c/KPfxrKkX):
 *
 *  - `to_date` is `"0000-00-00"` for oneway searches (not the empty
 *    string, not null) — a MySQL-zero-date sentinel leaking out
 *    through the API. OpenAPI treats `to_date` as a real ISO date.
 *  - `past-searches` only round-trips for surfer_ids ≤ 32 chars.
 *    `search-init` accepts longer ids silently (no error), but the
 *    storage layer truncates / drops them, so `past-searches` returns
 *    `[]`. Likely a `VARCHAR(32)` column constraint on the genesis
 *    side. Tests that need round-trip MUST use a ≤32-char surfer_id.
 */
export const PastSearchItemSchema = z.strictObject({
    from: z.string(),
    to: z.string(),
    from_code: z.string(),
    to_code: z.string(),
    from_airport_name: z.string(),
    to_airport_name: z.string(),
    from_date: z.string(),
    // drift: '0000-00-00' for oneway (MySQL zero-date sentinel),
    //        OpenAPI says ISO date. See https://trello.com/c/KPfxrKkX
    to_date: z.string(),
    to_banner: z.string(),
    search_params: PastSearchSearchParamsSchema,
});

/**
 * `GET /past-searches/{surferId}` — array of `FlightSearchPayload`
 * items per OpenAPI; live shape captured by seeding via `search-init`.
 *
 * Empty array is the natural state for an unseen / random surfer_id;
 * the strict per-item shape only applies to populated responses. Both
 * cases validate against this schema (`z.array` accepts length 0).
 */
export const PastSearchesResponseSchema = z.array(PastSearchItemSchema);

// ==================== /storefront-api/get-aeroplans ====================

/**
 * `GET /get-aeroplans` returns a JSON object keyed by airline IATA code
 * (e.g. `AC`, `WS`) mapped to its loyalty-programme name. No path or
 * query params; no auth required.
 */
// Airline IATA codes are 2 uppercase alphanumerics (`9W`, `AC`, `B6`).
const AirlineIataKeySchema = z
    .string()
    .regex(/^[A-Z0-9]{2}$/, 'IATA-2 airline code');

export const GetAeroplansResponseSchema = z.record(
    AirlineIataKeySchema,
    z.string()
);

// ==================== Type exports ====================

export type DatePickerPriceTier = zOutput<typeof DatePickerPriceTierSchema>;
export type DatePickerPriceEntry = zOutput<typeof DatePickerPriceEntrySchema>;
export type DatePickerMatrix = zOutput<typeof DatePickerMatrixSchema>;
export type DatePickerPricesSuccess = zOutput<
    typeof DatePickerPricesSuccessSchema
>;
export type DatePickerPricesFailure = zOutput<
    typeof DatePickerPricesFailureSchema
>;
export type DatePickerPricesResponse = zOutput<
    typeof DatePickerPricesResponseSchema
>;
export type RegionSelectResponse = zOutput<typeof RegionSelectResponseSchema>;
export type TopDealSearchParams = zOutput<typeof TopDealSearchParamsSchema>;
export type TopDealItem = zOutput<typeof TopDealItemSchema>;
export type TopDealsResponse = zOutput<typeof TopDealsResponseSchema>;
export type PastSearchSearchParams = zOutput<
    typeof PastSearchSearchParamsSchema
>;
export type PastSearchItem = zOutput<typeof PastSearchItemSchema>;
export type PastSearchesResponse = zOutput<typeof PastSearchesResponseSchema>;
export type GetAeroplansResponse = zOutput<typeof GetAeroplansResponseSchema>;
