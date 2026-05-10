import { z } from 'zod/v4';
import type { output as zOutput } from 'zod/v4';

/**
 * Zod schemas for the genesis Storefront API "search-flow" endpoints
 * (search-init, search-result-fetch, get-tax-breakdown, check-availability).
 *
 * Sourced from the Storefront API OpenAPI spec at
 * `app_source_code/genesis/include/Mv/Ota/Jfly/App/StorefrontApi/openapi.yaml`
 * and verified live against `https://staging2.flighthub.com/storefront-api/...`
 * and `https://staging2.justfly.com/storefront-api/...` (cross-brand parity
 * confirmed across 212 sampled packages spanning oneway, roundtrip, domestic,
 * transborder, international routes).
 *
 * The Package / Segment / CityPair / Layover / PriceDetails / Aircraft schemas
 * below encode the LIVE response shape, which diverges substantially from the
 * documented OpenAPI shape. Per the api-testing skill Phase 7 step 6 (the
 * `// drift:` exception), every divergent field carries an inline `// drift:`
 * marker linking https://trello.com/c/QxPqz6cS, and the OpenAPI-correct
 * happy path is preserved as a separate `test.skip` + `// FIXME:` in
 * `tests/shared/api/searchResultFetch.spec.ts`.
 *
 * The `filters` branch on search-result-fetch stays `z.unknown()` pending a
 * separate stakeholder agreement on which filter sub-shapes to lock in
 * (the live shape has 21 keys with content that varies per result set).
 */

// ==================== /storefront-api/search-init ====================

/**
 * `GET /search-init` response.
 *
 * OpenAPI documents only `{search_id: string}`. Live staging2 returns
 * `{search_id: string | null, np_si: boolean}` — `np_si` is undocumented
 * (drift), and `search_id` is `null` when required params are missing
 * (the live API soft-fails with 200 instead of 400, same family as
 * the rest of the storefront API). Both behaviours are encoded.
 */
export const SearchInitResponseSchema = z.strictObject({
    // drift: OpenAPI says `search_id` is non-null (failures should be 4xx);
    //        live API soft-fails with `null` on missing required params.
    //        See https://trello.com/c/QxPqz6cS
    search_id: z.string().nullable(),
    // drift: `np_si` is undocumented in OpenAPI; always `false` in captured
    //        runs. See https://trello.com/c/QxPqz6cS
    np_si: z.boolean(),
});

// ==================== /storefront-api/search-result-fetch ====================

/**
 * Basic airport reference (city_pair-level departure/arrival). 7 fields.
 *
 * The OpenAPI `Segment.departure` / `Segment.arrival` only document
 * `{datetime, airport_code}`; the live response adds the 5 city/country
 * fields below. Same shape used at city_pair level and as the base for
 * `AirportRefWithDistanceSchema` at segment level.
 */
export const AirportRefSchema = z.strictObject({
    airport_code: z.string(),
    // drift: OpenAPI omits airport_full_name. See https://trello.com/c/QxPqz6cS
    airport_full_name: z.string(),
    // drift: OpenAPI omits city_code. See https://trello.com/c/QxPqz6cS
    city_code: z.string(),
    // drift: OpenAPI omits city_full_name. See https://trello.com/c/QxPqz6cS
    city_full_name: z.string(),
    // drift: OpenAPI omits country_code. See https://trello.com/c/QxPqz6cS
    country_code: z.string(),
    // drift: OpenAPI omits country_full_name. See https://trello.com/c/QxPqz6cS
    country_full_name: z.string(),
    datetime: z.string(),
});

/**
 * Segment-level airport reference. Adds 3 optional fields that only appear
 * when the package substituted a "nearby" airport for the searched one.
 */
export const AirportRefWithDistanceSchema = z.strictObject({
    airport_code: z.string(),
    airport_full_name: z.string(),
    city_code: z.string(),
    city_full_name: z.string(),
    country_code: z.string(),
    country_full_name: z.string(),
    datetime: z.string(),
    // drift: OpenAPI omits airport_reference; live populates only when the
    //        booked airport differs from the searched airport (nearby
    //        substitution). See https://trello.com/c/QxPqz6cS
    airport_reference: z.string().optional(),
    // drift: OpenAPI omits distance; live serializes as a numeric string
    //        (e.g. "16.27"). See https://trello.com/c/QxPqz6cS
    distance: z.string().optional(),
    // drift: OpenAPI omits unit (always "km" in samples). See https://trello.com/c/QxPqz6cS
    unit: z.string().optional(),
});

/**
 * Aircraft block on a segment.
 *
 * Live serializes as `{code, full_name}` for known aircraft and as `[]`
 * (PHP empty-array idiom) when aircraft data is unavailable. The empty-array
 * branch is encoded explicitly so `z.strictObject` does not reject it.
 */
export const AircraftSchema = z.strictObject({
    code: z.string(),
    full_name: z.string(),
});

// drift: OpenAPI declares `aircraft` as a non-nullable object; live returns
//        `[]` when missing (15-40% of segments in sampled runs — PHP empty
//        associative-array serialization). See https://trello.com/c/QxPqz6cS
export const AircraftOrEmptySchema = z.union([
    AircraftSchema,
    z.array(z.never()).max(0),
]);

/**
 * Per-segment shape (one leg of a city pair). 20 fields in live responses;
 * OpenAPI documents ~9 simpler fields.
 */
export const SegmentSchema = z.strictObject({
    departure: AirportRefWithDistanceSchema,
    arrival: AirportRefWithDistanceSchema,
    // drift: OpenAPI puts trip_time on the city_pair-equivalent ($ref to
    //        FlightTimeDuration), not on the segment. Live duplicates it
    //        on the segment too (minutes). See https://trello.com/c/QxPqz6cS
    trip_time: z.int(),
    marketing_carrier: z.string(),
    // drift: OpenAPI omits marketing_carrier_name. See https://trello.com/c/QxPqz6cS
    marketing_carrier_name: z.string(),
    // drift: OpenAPI types operating_carrier as required string; live often
    //        returns null when codeshare / operator is unknown.
    //        See https://trello.com/c/QxPqz6cS
    operating_carrier: z.string().nullable(),
    // drift: OpenAPI omits operating_carrier_name; live nullable.
    //        See https://trello.com/c/QxPqz6cS
    operating_carrier_name: z.string().nullable(),
    display_carrier: z.string(),
    // drift: OpenAPI omits display_carrier_name. See https://trello.com/c/QxPqz6cS
    display_carrier_name: z.string(),
    // drift: OpenAPI omits alternate_operated_by_airline_name; nullable.
    //        See https://trello.com/c/QxPqz6cS
    alternate_operated_by_airline_name: z.string().nullable(),
    flight_number: z.string(),
    // drift: OpenAPI declares `cabin: CabinType` enum [Economy, EconomyPremium,
    //        Business, First] (PascalCase); live returns lowercase snake_case
    //        ('economy', 'economy_premium' observed). Kept as plain string
    //        because the live universe of values is not yet fully sampled.
    //        See https://trello.com/c/QxPqz6cS
    cabin: z.string(),
    // drift: OpenAPI omits fare_family; live returns a string (sometimes
    //        empty `""`). See https://trello.com/c/QxPqz6cS
    fare_family: z.string(),
    // drift: OpenAPI declares `amenities: Amenities[]` with a placeholder
    //        enum [this, is, a, dummy, list]; live returns an empty string
    //        array in every sampled segment. Kept as `z.array(z.string())`
    //        until non-empty samples surface. See https://trello.com/c/QxPqz6cS
    amenities: z.array(z.string()),
    // drift: OpenAPI omits equipment_type ('air' observed). See https://trello.com/c/QxPqz6cS
    equipment_type: z.string(),
    aircraft: AircraftOrEmptySchema,
    // drift: OpenAPI omits is_flex_*. See https://trello.com/c/QxPqz6cS
    is_flex_departure: z.boolean(),
    is_flex_return: z.boolean(),
    // drift: OpenAPI omits is_nearby_*; correlate with
    //        AirportRefWithDistanceSchema's optional fields.
    //        See https://trello.com/c/QxPqz6cS
    is_nearby_departure: z.boolean(),
    is_nearby_arrival: z.boolean(),
});

/**
 * Layover between two segments of the same city_pair. 10 fields; OpenAPI
 * documents 3 (city_name, airport_code, layover_time).
 */
export const LayoverSchema = z.strictObject({
    airport_code: z.string(),
    // drift: OpenAPI uses `city_name`; live uses `airport_full_name` plus
    //        the city/country detail block. See https://trello.com/c/QxPqz6cS
    airport_full_name: z.string(),
    city_code: z.string(),
    city_full_name: z.string(),
    country_code: z.string(),
    country_full_name: z.string(),
    // drift: OpenAPI omits equipment_type. Live: 'air' on most layovers,
    //        null on a non-trivial fraction (likely when the upstream GDS
    //        does not expose the equipment classification — e.g. some
    //        codeshare connections). See https://trello.com/c/QxPqz6cS
    equipment_type: z.string().nullable(),
    // drift: OpenAPI omits is_change_airport_required. See https://trello.com/c/QxPqz6cS
    is_change_airport_required: z.boolean(),
    // drift: OpenAPI omits layover_length_type. Live: 'long' / 'short' /
    //        null. See https://trello.com/c/QxPqz6cS
    layover_length_type: z.string().nullable(),
    layover_time: z.int(),
});

/**
 * One outbound or return city_pair within a Package.
 *
 * Live structure groups segments + layovers under each leg; OpenAPI declares
 * Package.city_pairs as `array of Segment` (no intermediate CityPair), which
 * does not match the live response.
 */
// drift: OpenAPI's Package.city_pairs is `array of Segment` directly; live
//        wraps each leg in a CityPair object that contains its own
//        departure/arrival summary, segments, and layovers. See https://trello.com/c/QxPqz6cS
export const CityPairSchema = z.strictObject({
    departure: AirportRefSchema,
    arrival: AirportRefSchema,
    trip_time: z.int(),
    segments: z.array(SegmentSchema),
    layovers: z.array(LayoverSchema),
});

/**
 * Price block on a Package.
 *
 * OpenAPI documents `{base, tax, total, currency}`; live adds
 * `total_per_passenger`.
 */
export const PriceDetailsSchema = z.strictObject({
    base: z.number(),
    tax: z.number(),
    total: z.number(),
    // drift: OpenAPI omits total_per_passenger. See https://trello.com/c/QxPqz6cS
    total_per_passenger: z.number(),
    // OpenAPI: `pattern: '^[A-Z]{3}$'`. ISO-4217-style 3-letter currency code.
    currency: z.string().regex(/^[A-Z]{3}$/),
});

/**
 * Per-package shape (the value side of `packages: { [packageId]: Package }`).
 *
 * Live: 10 fields, all observed in 100% of sampled packages except
 * `seats_available` (nullable, ~5% null) and `tags` (often empty array).
 * Cross-brand parity confirmed against both Flighthub and JustFly staging2.
 */
export const PackageSchema = z.strictObject({
    // OpenAPI: `tags: string[]`. Live values observed: 'best', 'cheapest',
    // 'shortest', 'nearby_airport'.
    tags: z.array(z.string()),
    // drift: OpenAPI omits Package.type (the `oneway` / `roundtrip` indicator
    //        echoed back from the search-init params). See https://trello.com/c/QxPqz6cS
    type: z.string(),
    // drift: OpenAPI omits route_type ('domestic', 'transborder',
    //        'international' observed). See https://trello.com/c/QxPqz6cS
    route_type: z.string(),
    // drift: OpenAPI omits is_multiticket. See https://trello.com/c/QxPqz6cS
    is_multiticket: z.boolean(),
    // drift: OpenAPI declares seats_available as a required integer; live
    //        returns null on a small fraction of packages (likely when the
    //        upstream GDS does not surface the count).
    //        See https://trello.com/c/QxPqz6cS
    seats_available: z.int().nullable(),
    // drift: OpenAPI omits is_affirm_eligible (Affirm financing flag).
    //        See https://trello.com/c/QxPqz6cS
    is_affirm_eligible: z.boolean(),
    // drift: OpenAPI declares city_pairs as `array of Segment`; live wraps
    //        each leg in CityPair (see CityPairSchema). See https://trello.com/c/QxPqz6cS
    city_pairs: z.array(CityPairSchema),
    price: PriceDetailsSchema,
    validating_carrier: z.string(),
    // drift: OpenAPI omits has_cc_fees (credit-card fee surcharge flag).
    //        See https://trello.com/c/QxPqz6cS
    has_cc_fees: z.boolean(),
});

// ==================== filters block (search-result-fetch) ====================

/**
 * The `filters` block on `search-result-fetch` responses.
 *
 * Captured 2026-05-07 across 7 search variants on staging2 (oneway
 * domestic / transborder / international, roundtrip transborder,
 * multi-pax international, distinct-OD international, both Flighthub
 * and JustFly). 21 top-level keys, every one present in every capture.
 *
 * The schemas below encode the LIVE shape only — the OpenAPI spec
 * documents this block as `Filters: {}` (empty schema), so every
 * sub-shape here is technically a drift surface; the cross-capture
 * stability is what makes locking it in safe. Documented variations:
 *
 *   - `carriers.multi` is optional (absent on small result sets, e.g.
 *     `fh_roundtrip_transborder` returned 1 package and no `multi`).
 *   - `layover_airports` collapses from `{label, content}` to `[]` (PHP
 *     empty-array idiom) when no layovers are possible.
 *   - `stops.content` collapses from `{[digit]: StopOption}` to
 *     `[StopOption]` (PHP empty-keyed-list idiom) when only the
 *     non-stop option is available.
 *   - Boolean-flag fields (`state`, `default` on toggles) are `0|1`
 *     ints — not real booleans — across every capture.
 *
 * Capture matrix lives at https://trello.com/c/vuPgw8Ks (Flavor C2).
 * If a future drift surfaces (new top-level key, key removed, or a
 * sub-shape collapsed to a new branch), tighten the union here rather
 * than loosening to `z.unknown()` — silently dropping coverage is
 * what the No-Silent-Coverage-Drops rule was written to prevent.
 */

/** `state` / `default` on toggle-style filters are 0|1 ints, not booleans. */
const ZeroOneIntSchema = z.union([z.literal(0), z.literal(1)]);

/** PHP empty-associative-array idiom: any object that should be a `{...}`
 * gets serialized as `[]` when its content is empty. Genesis hits this on
 * the `__nonexistent_search_id__` / pre-completion branches where filter
 * blocks are populated from the (still-empty) result set.
 */
const PhpEmptyArraySchema = z.array(z.never()).max(0);

/** Toggle-style filter: a single `{label, state, default}` triplet. Used
 * by `only_same_origin_destination_airport`, `show_advertised_flex`,
 * `show_alternate_airports`, `show_super_savers`. */
const ToggleFilterSchema = z.strictObject({
    label: z.string(),
    state: ZeroOneIntSchema,
    default: ZeroOneIntSchema,
});

/** Common `{value: "USD 549.97", value_rounded_up: "USD 550"}` price-label
 * pair used by every option that shows a from-price hint. */
const StopOptionSchema = z.strictObject({
    label: z.string(),
    value: z.string(),
    value_rounded_up: z.string(),
    state: ZeroOneIntSchema,
    default: ZeroOneIntSchema,
});

const StopsFilterPopulatedSchema = z.strictObject({
    label: z.string(),
    // Live: `{"0": ..., "1": ..., "2": ...}` keyed by stop-count when 2+
    // options are available, but a singleton non-stop case collapses to
    // `[StopOption]` (PHP serializes a single-element associative array
    // with sequential numeric keys as a plain list).
    content: z.union([
        z.record(
            z
                .string()
                .regex(/^\d+$/, 'stop count as a non-negative int string'),
            StopOptionSchema
        ),
        z.array(StopOptionSchema),
    ]),
});

const StopsFilterSchema = z.union([
    StopsFilterPopulatedSchema,
    PhpEmptyArraySchema,
]);

const BaggageOptionSchema = z.strictObject({
    label: z.string(),
    state: ZeroOneIntSchema,
    default: ZeroOneIntSchema,
    count: z.int(),
});

const BaggagesFilterSchema = z.strictObject({
    label: z.string(),
    content: z.record(
        z
            .string()
            .regex(/^(carry_on|checked_baggage)$/, 'genesis baggage type'),
        BaggageOptionSchema
    ),
});

const CarrierOptionSchema = z.strictObject({
    value: z.string(),
    value_rounded_up: z.string(),
    code: z.string(),
    label: z.string(),
    state: ZeroOneIntSchema,
    default: ZeroOneIntSchema,
});

const CarriersFilterPopulatedSchema = z.strictObject({
    label: z.string(),
    // Keys are airline IATA codes (2-3 alphanumerics — `9W`, `AC`, `B6`).
    content: z.record(
        z.string().regex(/^[A-Z0-9]{2,3}$/, 'IATA-2/3 airline code'),
        CarrierOptionSchema
    ),
    // Optional aggregate "Multiple Airlines" pseudo-carrier — present when
    // at least one multi-airline package surfaces, absent on tiny result
    // sets (1-package roundtrip, single-carrier domestic).
    multi: CarrierOptionSchema.optional(),
});

const CarriersFilterSchema = z.union([
    CarriersFilterPopulatedSchema,
    PhpEmptyArraySchema,
]);

const LayoverAirportOptionSchema = z.strictObject({
    state: ZeroOneIntSchema,
    code: z.string(),
    default: ZeroOneIntSchema,
    label: z.string(),
    airport_name: z.string(),
    value: z.string(),
    value_rounded_up: z.string(),
});

const LayoverAirportsFilterSchema = z.union([
    z.strictObject({
        label: z.string(),
        content: z.record(
            z.string().regex(/^[A-Z]{3}$/, 'IATA-3 airport code'),
            LayoverAirportOptionSchema
        ),
    }),
    z.array(z.never()).max(0),
]);

const OrderByOptionSchema = z.strictObject({
    package_id: z.string(),
    price: z.number(),
    price_per_pax: z.number(),
    trip_time: z.int(),
    // Live: 'YYYY-MM-DD HH:MM:SS' (no timezone — local airport time).
    departure_time: z.string(),
});

const OrderByFilterSchema = z.strictObject({
    default: z.enum(['best', 'cheapest', 'shortest']),
    state: z.enum(['best', 'cheapest', 'shortest']),
    // Always observed null in the captured matrix (currency_only_resort UI
    // hint, not exercised by `search-result-fetch`).
    currency: z.string().nullable(),
    // Each per-mode entry is an `OrderByOption` when the result set has
    // packages, or `[]` (PHP empty-array idiom) on the empty / unknown
    // search-id branch.
    content: z.record(
        z.enum(['best', 'cheapest', 'shortest']),
        z.union([OrderByOptionSchema, PhpEmptyArraySchema])
    ),
});

const OrderDirectionFilterSchema = z.strictObject({
    default: z.enum(['ASC', 'DESC']),
    state: z.enum(['ASC', 'DESC']),
    // Always exactly the 2-tuple ['ASC', 'DESC'] — no other values surfaced.
    value: z.tuple([z.literal('ASC'), z.literal('DESC')]),
});

const PaginationFilterSchema = z.strictObject({
    default: z.int(),
    state: z.int(),
    max: z.int(),
});

const ConnectionTimeFilterSchema = z.strictObject({
    label: z.string(),
    value: z.array(z.int()),
    // On the empty-results / unknown-search-id branch, `state` and `default`
    // collapse to `false` instead of an int. Allow the boolean fall-through
    // explicitly so this stays caught instead of being papered over.
    state: z.union([z.int(), z.boolean()]),
    default: z.union([z.int(), z.boolean()]),
});

const SearchAirportsAirportOptionSchema = z.strictObject({
    value: z.string(),
    value_rounded_up: z.string(),
    state: ZeroOneIntSchema,
    code: z.string(),
    default: ZeroOneIntSchema,
    price: z.number(),
    name: z.string(),
});

const SearchAirportsCityBlockSchema = z.strictObject({
    label: z.string(),
    content: z.record(
        z.string().regex(/^[A-Z]{3}$/, 'IATA-3 airport code'),
        SearchAirportsAirportOptionSchema
    ),
});

const SearchAirportsFilterSchema = z.strictObject({
    // On the empty-results / unknown-search-id branch each city block
    // collapses to `[]` (PHP empty-array idiom) instead of the
    // `{label, content}` populated shape.
    origin: z.union([SearchAirportsCityBlockSchema, PhpEmptyArraySchema]),
    destination: z.union([SearchAirportsCityBlockSchema, PhpEmptyArraySchema]),
    // 'searchedOnly' observed across every capture; kept open as a string
    // because the live universe of mode values is not yet sampled (the
    // `search_airports.mode` UI control likely emits other values when
    // alternate-airport browsing is toggled).
    mode: z.string(),
    label: z.string(),
});

const FlightTimeRangeSchema = z.tuple([z.int(), z.int()]);

const FlightTimeBlockSchema = z.strictObject({
    default: FlightTimeRangeSchema,
    value: FlightTimeRangeSchema,
    state: FlightTimeRangeSchema,
});

const FlightTimeEntrySchema = z.strictObject({
    label: z.string(),
    airport_code: z.string(),
    city: z.string(),
    departure_airport_code: z.string(),
    departure_city: z.string(),
    departure_label: z.string(),
    departure: FlightTimeBlockSchema,
    arrival: FlightTimeBlockSchema,
});

export const FiltersSchema = z.strictObject({
    baggages: BaggagesFilterSchema,
    carriers: CarriersFilterSchema,
    connection_time: ConnectionTimeFilterSchema,
    connection_times: z.array(z.int()),
    // Always `[]` in the captured matrix — kept as a typed empty array so
    // a future populated case (the UI surfaces excluded segments after a
    // user toggles a flight off) lands as a strict-schema failure for review.
    excluded_segments: z.array(z.unknown()),
    flight_times: z.array(FlightTimeEntrySchema),
    layover_airports: LayoverAirportsFilterSchema,
    longer_trips: z.int(),
    only_same_origin_destination_airport: ToggleFilterSchema,
    order_by: OrderByFilterSchema,
    order_direction: OrderDirectionFilterSchema,
    pagination: PaginationFilterSchema,
    pinned_city_pair_flights: z.array(z.unknown()),
    pinned_city_pair_pid: z.string().nullable(),
    // Always `[min, max]` price-bucket bounds (e.g. `[0, 5200]`) in the
    // captured matrix.
    prices: z.tuple([z.int(), z.int()]),
    search_airports: SearchAirportsFilterSchema,
    show_advertised_flex: ToggleFilterSchema,
    show_alternate_airports: ToggleFilterSchema,
    show_only_flex: z.boolean(),
    show_super_savers: ToggleFilterSchema,
    stops: StopsFilterSchema,
});

/**
 * `GET /search-result-fetch/{searchId}` response.
 *
 * Top-level shape: documented metadata + `filtered_package_count` (drift),
 * a strict per-package map (live shape encoded above), and the strict
 * `filters` block (see `FiltersSchema` above; tightened via the C2
 * capture matrix at https://trello.com/c/vuPgw8Ks).
 */
export const SearchResultFetchResponseSchema = z.strictObject({
    completed: z.boolean(),
    current_page: z.int(),
    total_pages: z.int(),
    all_package_count: z.int(),
    // drift: OpenAPI omits filtered_package_count. See https://trello.com/c/QxPqz6cS
    filtered_package_count: z.int(),
    paged_package_count: z.int(),
    // Empty-results case is `[]` (PHP empty-array idiom); populated case is
    // `{ [packageId]: Package }`.
    packages: z.union([
        z.array(z.never()).max(0),
        z.record(z.string(), PackageSchema),
    ]),
    filters: FiltersSchema,
});

// ==================== /storefront-api/get-tax-breakdown ====================

/**
 * `GET /get-tax-breakdown/{searchId}/{packageId}` failure envelope.
 *
 * Live captured against `INVALID_SEARCH/INVALID_PKG`:
 * `{success: false, error_code: 2000002, error_message: "Package not found", error_details: []}`.
 * The success branch (when a real package id is available) is documented in
 * the OpenAPI spec as `{tax_breakdown: TaxBreakdown}` but cannot be
 * exercised here without seeded search results — strict schema lands on
 * a follow-up.
 */
export const TaxBreakdownFailureSchema = z.strictObject({
    success: z.literal(false),
    error_code: z.int(),
    error_message: z.string(),
    // FIXME: https://trello.com/c/sQ8M7w9e — `error_details` has been
    //        consistently `[]` across every captured failure: per
    //        2026-05-07 recon, search endpoints (including
    //        `tax-breakdown`) do not log to MongoDB `ota.debug_logs`
    //        (see db-docs/mongodb/debug_logs.md), and an input-fuzz
    //        pass surfaced no non-empty case. Schema stays open as
    //        `z.array(z.unknown())` until a triggerable case appears.
    //        Original tracker https://trello.com/c/QxPqz6cS.
    error_details: z.array(z.unknown()),
});

/**
 * `GET /get-tax-breakdown/{searchId}/{packageId}` success envelope.
 *
 * OpenAPI: `{tax_breakdown: TaxBreakdown}` where `TaxBreakdown` maps a
 * passenger-type code (`adt` / `chd` / `inf` / `ins`) to a `{tax_code:
 * amount_string}` map. Recon (2026-05-07, YUL→LHR multi-pax oneway):
 *   {
 *     "tax_breakdown": {
 *       "adt": {"YQ": "206.30", "YR": "0.00", "Q": "0.00"},
 *       "chd": {"YQ": "206.30", "YR": "0.00", "Q": "0.00"}
 *     }
 *   }
 * Amounts are decimal STRINGS (live serialization — preserves the GDS
 * fare-quote precision; the storefront UI parses them as `number`
 * before display). The strict regexes below reject any future drift to
 * a stray third-party field or numeric amount.
 */
const PassengerTypeKeySchema = z
    .string()
    .regex(/^(adt|chd|inf|ins)$/, 'genesis passenger type code');

const TaxCodeKeySchema = z
    .string()
    .regex(
        /^[A-Z0-9]{1,3}$/,
        'IATA tax code (uppercase alphanumeric, 1-3 chars)'
    );

const AmountStringSchema = z
    .string()
    .regex(/^-?\d+\.\d{2}$/, 'decimal string with 2 fraction digits');

// drift: OpenAPI declares the per-passenger bucket as a non-nullable
//        `{tax_code: amount}` map. Live staging2 occasionally returns
//        `null` for the entire bucket (observed: a Flighthub
//        oneway YUL→JFK package whose ADT bucket came back `null`),
//        likely when the upstream GDS does not surface any per-pax
//        tax detail for that fare quote. Allow `null` so the schema
//        keeps catching real drift instead of failing on a
//        no-detail-available case. See https://trello.com/c/QxPqz6cS
export const TaxBreakdownSuccessSchema = z.strictObject({
    tax_breakdown: z.record(
        PassengerTypeKeySchema,
        z.record(TaxCodeKeySchema, AmountStringSchema).nullable()
    ),
});

export const TaxBreakdownResponseSchema = z.union([
    TaxBreakdownSuccessSchema,
    TaxBreakdownFailureSchema,
]);

// ==================== /storefront-api/check-availability ====================

/**
 * `GET /check-availability/{searchId}/{packageId}` failure envelope.
 *
 * Live captured against `INVALID_SEARCH/INVALID_PKG`:
 * `{success: false, package: null}`. Success branch (with a real package)
 * follows on a populated-data follow-up (https://trello.com/c/QxPqz6cS).
 */
export const CheckAvailabilityFailureSchema = z.strictObject({
    success: z.literal(false),
    package: z.null(),
});

/**
 * `GET /check-availability/{searchId}/{packageId}` success envelope.
 *
 * Live captured 2026-05-07 against a real `(searchId, packageId)` pair
 * from `search-result-fetch`: `{success: true, package: <Package>}`.
 * The inner `package` reuses the live-shape `PackageSchema` already
 * documented in this module (the same 10-key block returned by
 * `search-result-fetch.packages[id]`), so all the existing `// drift:`
 * markers carry through. No new drift surface here.
 */
export const CheckAvailabilitySuccessSchema = z.strictObject({
    success: z.literal(true),
    package: PackageSchema,
});

export const CheckAvailabilityResponseSchema = z.union([
    CheckAvailabilitySuccessSchema,
    CheckAvailabilityFailureSchema,
]);

// ==================== Type exports ====================

export type SearchInitResponse = zOutput<typeof SearchInitResponseSchema>;
export type SearchResultFetchResponse = zOutput<
    typeof SearchResultFetchResponseSchema
>;
export type Package = zOutput<typeof PackageSchema>;
export type CityPair = zOutput<typeof CityPairSchema>;
export type Segment = zOutput<typeof SegmentSchema>;
export type Layover = zOutput<typeof LayoverSchema>;
export type PriceDetails = zOutput<typeof PriceDetailsSchema>;
export type Aircraft = zOutput<typeof AircraftSchema>;
export type AirportRef = zOutput<typeof AirportRefSchema>;
export type AirportRefWithDistance = zOutput<
    typeof AirportRefWithDistanceSchema
>;
export type TaxBreakdownFailure = zOutput<typeof TaxBreakdownFailureSchema>;
export type TaxBreakdownSuccess = zOutput<typeof TaxBreakdownSuccessSchema>;
export type TaxBreakdownResponse = zOutput<typeof TaxBreakdownResponseSchema>;
export type CheckAvailabilityFailure = zOutput<
    typeof CheckAvailabilityFailureSchema
>;
export type CheckAvailabilitySuccess = zOutput<
    typeof CheckAvailabilitySuccessSchema
>;
export type CheckAvailabilityResponse = zOutput<
    typeof CheckAvailabilityResponseSchema
>;
export type Filters = zOutput<typeof FiltersSchema>;
