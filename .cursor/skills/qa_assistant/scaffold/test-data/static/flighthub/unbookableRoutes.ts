/**
 * Curated Flighthub search inputs that reliably surface the
 * "No flights found" empty state on staging2.
 *
 * Distinct from `INVALID_AIRPORT_PAIRS` in `invalidSearchInputs.ts`: those
 * cases are rejected by the storefront's client-side validation and never
 * reach the GDS. The pairs below are accepted by validation, hit the GDS,
 * and come back with zero inventory — exactly what the no-results test
 * needs.
 *
 * Captured 2026-05-04 via `playwright-cli`. Add new entries with a
 * `description` that drives the test title in any future data-driven loop.
 */

export const UNBOOKABLE_ONE_WAY_ROUTES = [
    {
        description: 'same-airport one-way (YYZ -> YYZ)',
        origin: 'YYZ',
        destination: 'YYZ',
    },
] as const;
