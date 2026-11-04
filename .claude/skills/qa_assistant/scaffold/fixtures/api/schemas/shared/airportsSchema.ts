import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Single airport object returned by both `airports-autocomplete` and
 * `airports-nearby`.
 *
 * Sourced from the OpenAPI `AirportsInfoList` component (which despite its
 * name describes the per-airport object, not the list wrapper) at
 * `app_source_code/genesis/include/Mv/Ota/Jfly/App/StorefrontApi/openapi.yaml`
 * lines 797-846.
 *
 * The 16 documented fields are kept in OpenAPI order. The trailing 4 fields
 * (`popularity`, `province`, `raw_country`, `raw_province`) are returned by the
 * live staging2 API but are NOT in the OpenAPI spec — captured live from
 * `GET /storefront-api/airports-autocomplete?term=New Y` and
 * `GET /storefront-api/airports-nearby?latitude=...&longitude=...&country_code=CAN`.
 * Filed as OpenAPI drift on https://trello.com/c/aqt8sucM. They are encoded here
 * because `z.strictObject` (per the `type-safety` skill) forbids loosening the
 * schema to swallow them silently.
 *
 * `city_group` and `raw_province` are nullable in live responses (e.g. NYC
 * autocomplete row has `city_group: null`).
 */
export const AirportInfoSchema = z.strictObject({
    code: z.string(),
    clean_code: z.string(),
    raw_code: z.string(),
    name: z.string(),
    clean_name: z.string(),
    airport_name: z.string(),
    city: z.string(),
    short_name: z.string(),
    country_code: z.string(),
    is_city: z.boolean(),
    city_group: z.string().nullable(),
    is_major_airport: z.boolean(),
    short_city_name: z.string(),
    short_address: z.string(),
    raw_short_address: z.string(),
    highlighted_airport_name: z.string(),
    popularity: z.number(),
    province: z.string(),
    raw_country: z.string(),
    raw_province: z.string().nullable(),
});

/**
 * Response shape for `GET /storefront-api/airports-autocomplete`.
 *
 * Captured live: a JSON array of `AirportInfo` objects (empty array `[]` when
 * `term` is empty / missing — the live API ignores the OpenAPI `required: true`
 * marker, see https://trello.com/c/aqt8sucM).
 */
export const AirportsAutocompleteResponseSchema = z.array(AirportInfoSchema);

/**
 * Response shape for `GET /storefront-api/airports-nearby`.
 *
 * The live API returns one of two shapes depending on whether any airports
 * match the geo + country filter:
 * - Empty case (e.g. ocean point or out-of-range latitude): JSON empty array
 *   `[]`.
 * - Populated case: JSON object keyed by an arbitrary string (live values seen:
 *   the airport code like `"YUL"` when no `latitude` was supplied, or numeric
 *   indices like `"0"`, `"2"`, `"3"` when supplied) mapping to an `AirportInfo`
 *   object.
 *
 * The shape inconsistency (`[]` vs `{}` for the same endpoint) is filed as a
 * backend bug on https://trello.com/c/aqt8sucM.
 */
// Live keys are EITHER an IATA-3 airport code (uppercase, e.g. "YUL") when no
// `latitude` was supplied, OR a non-negative numeric index (e.g. "0", "2", "3")
// when supplied. Either form is accepted; mixed shapes within one response are
// not expected. See https://trello.com/c/aqt8sucM for the upstream drift bug.
const AirportsNearbyKeySchema = z
    .string()
    .regex(/^([A-Z]{3}|\d+)$/, 'IATA-3 uppercase or numeric index');

export const AirportsNearbyResponseSchema = z.union([
    z.array(AirportInfoSchema),
    z.record(AirportsNearbyKeySchema, AirportInfoSchema),
]);

export type AirportInfo = zOutput<typeof AirportInfoSchema>;
export type AirportsAutocompleteResponse = zOutput<
    typeof AirportsAutocompleteResponseSchema
>;
export type AirportsNearbyResponse = zOutput<
    typeof AirportsNearbyResponseSchema
>;
