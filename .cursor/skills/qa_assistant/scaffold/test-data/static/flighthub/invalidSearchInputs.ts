/**
 * Curated invalid Flighthub search inputs for negative / validation tests.
 *
 * These are domain-specific cases (same origin and destination, past dates,
 * out-of-range pax counts, malformed IATA codes) — distinct from the
 * universal type-mismatch arrays in `test-data/static/util/invalid-values.ts`.
 *
 * `as const` is required: it preserves narrow literal types and rejects
 * accidental mutations downstream. Per the data-strategy skill, never use
 * `.json` for static data.
 *
 * The `description` on each row drives the test title in data-driven loops:
 * `test(`rejects when ${description}`, ...)`.
 */

export const INVALID_AIRPORT_PAIRS = [
    { description: 'origin equals destination', from: 'YUL', to: 'YUL' },
    { description: 'origin is empty', from: '', to: 'JFK' },
    { description: 'destination is empty', from: 'YUL', to: '' },
    { description: 'origin is non-IATA garbage', from: 'XX1', to: 'JFK' },
    {
        description: 'destination is too long',
        from: 'YUL',
        to: 'TOOLONG',
    },
] as const;

export const INVALID_DATE_INPUTS = [
    { description: 'departure date in the past', date: '2020-01-01' },
    { description: 'departure date is empty string', date: '' },
    { description: 'departure date is malformed', date: 'tomorrow' },
    {
        description: 'departure date is invalid calendar value',
        date: '2026-13-40',
    },
] as const;

export const INVALID_RETURN_DATE_PAIRS = [
    {
        description: 'return date is before departure',
        departureDate: '2026-08-15',
        returnDate: '2026-08-14',
    },
    {
        description: 'return date is the same day as departure',
        departureDate: '2026-08-15',
        returnDate: '2026-08-15',
    },
] as const;

export const INVALID_PASSENGER_COUNTS = [
    { description: 'zero adults', adults: 0 },
    { description: 'negative adults', adults: -1 },
    { description: 'more than 9 adults', adults: 10 },
    { description: 'fractional adults', adults: 1.5 },
] as const;
