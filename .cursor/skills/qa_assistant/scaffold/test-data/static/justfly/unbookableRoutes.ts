/**
 * Curated JustFly search inputs that reliably surface the
 * "No flights found" empty state on staging2.
 *
 * Mirrors the Flighthub set: same genesis-storefront codebase, so the
 * same same-airport one-way is accepted by client validation, hits the
 * GDS, and returns zero inventory. Add new entries with a `description`
 * that drives the test title in any future data-driven loop.
 */
export const UNBOOKABLE_ONE_WAY_ROUTES = [
    {
        description: 'same-airport one-way (YYZ -> YYZ)',
        origin: 'YYZ',
        destination: 'YYZ',
    },
] as const;
