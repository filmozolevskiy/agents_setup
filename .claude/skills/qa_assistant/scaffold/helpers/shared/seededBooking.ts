/**
 * Resolve the per-brand seeded booking metadata declared in
 * `env/.env.shared` (template: `env/.env.shared.example`).
 *
 * Genesis looks bookings up by `id + last_name + site_id`, so the same
 * booking row cannot satisfy both brand projects — each brand has its
 * own seeded booking. The cross-brand `tests/shared/api/refSearch*` and
 * `tests/shared/api/resendTotp.spec.ts` happy paths consume
 * {@link seededBooking}; the FlightHub booking-confirmation page object
 * consumes {@link seededBookingIdHash} for its `/service/portal/detail/{id_hash}`
 * deep-link (the `id_hash` column is a separate env var so the older
 * callers remain back-compat — see the migration note below).
 *
 * Each accessor throws on first read if its required env vars are missing
 * — this is a setup failure (the spec cannot run without seeded data),
 * not a runtime branch the test should `skip` over.
 *
 * Migration: the original `seededBooking()` returned `{ bookingId,
 * lastName }`. The `bookingConfirmation` page-object work added the
 * `BOOKING_ID_HASH_*` requirement to power the trip-detail deep-link,
 * but rather than throw `seededBooking()` for callers that never needed
 * the hash (every existing `tests/shared/api/*` spec), the hash lookup
 * now lives in a separate `seededBookingIdHash()` accessor. Callers that
 * need both fields call both helpers.
 */

import type { Brand } from './genesisTotp';

export type SeededBooking = {
    bookingId: string;
    lastName: string;
};

/**
 * @param brand - Defaults to `process.env.BRAND` (the value
 *   `playwright.config.ts` exports per project). Pass an explicit
 *   brand only for cross-brand setup helpers; tests should rely on
 *   the default.
 * @throws If `BOOKING_ID_<FH|JF>` or `BOOKING_LAST_NAME_<FH|JF>` is
 *   missing for the resolved brand.
 */
export function seededBooking(brand?: Brand): SeededBooking {
    const resolvedBrand = resolveBrand(brand);

    const idVar =
        resolvedBrand === 'flighthub' ? 'BOOKING_ID_FH' : 'BOOKING_ID_JF';
    const lastNameVar =
        resolvedBrand === 'flighthub'
            ? 'BOOKING_LAST_NAME_FH'
            : 'BOOKING_LAST_NAME_JF';

    const bookingId = process.env[idVar];
    const lastName = process.env[lastNameVar];

    if (!bookingId || !lastName) {
        throw new Error(
            `seededBooking: ${idVar} / ${lastNameVar} not both set for brand "${resolvedBrand}". ` +
                `Populate .env at the repo root (BOOKING_ID_${resolvedBrand === 'flighthub' ? 'FH' : 'JF'} / BOOKING_LAST_NAME_${resolvedBrand === 'flighthub' ? 'FH' : 'JF'}).`
        );
    }

    return { bookingId, lastName };
}

/**
 * Resolve the per-brand `bookings.id_hash` opaque token used by the
 * storefront's `/service/portal/detail/{id_hash}` deep-link. Kept as a
 * separate accessor so callers that only need `(bookingId, lastName)`
 * stay green even when `BOOKING_ID_HASH_*` is unset.
 *
 * @param brand - Defaults to `process.env.BRAND`.
 * @throws If `BOOKING_ID_HASH_<FH|JF>` is missing for the resolved brand.
 */
export function seededBookingIdHash(brand?: Brand): string {
    const resolvedBrand = resolveBrand(brand);

    const idHashVar =
        resolvedBrand === 'flighthub'
            ? 'BOOKING_ID_HASH_FH'
            : 'BOOKING_ID_HASH_JF';
    const idHash = process.env[idHashVar];

    if (!idHash) {
        throw new Error(
            `seededBookingIdHash: ${idHashVar} not set for brand "${resolvedBrand}". ` +
                `Populate .env at the repo root (BOOKING_ID_HASH_${resolvedBrand === 'flighthub' ? 'FH' : 'JF'}).`
        );
    }

    return idHash;
}

function resolveBrand(brand?: Brand): Brand {
    return brand ?? (process.env.BRAND as Brand | undefined) ?? 'flighthub';
}
