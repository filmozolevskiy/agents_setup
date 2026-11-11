/**
 * Domain-specific invalid input values for the genesis Storefront API
 * `/storefront-api/airports-*` endpoints.
 *
 * Universal type-mismatch arrays (`INVALID_STRING_VALUES`,
 * `INVALID_NUMBER_VALUES`, etc.) live in
 * `test-data/static/util/invalid-values.ts`. This file holds curated values
 * that exercise endpoint-specific boundaries — non-numeric latitude/longitude
 * shapes that crash the genesis backend with a 500 PHP TypeError, and
 * malformed ISO 3166-1 alpha-3 country codes.
 *
 * Imported and iterated with `for...of` in `tests/shared/api/airports.spec.ts`.
 * Never redefine inline.
 */

export const NEARBY_NON_NUMERIC_LAT_LON_VALUES = [
    'abc',
    'true',
    'null',
    '<script>',
    '1 OR 1=1',
] as const;

export const INVALID_COUNTRY_CODE_VALUES = [
    'XYZ',
    'CA',
    'cana',
    '',
    '123',
] as const;
