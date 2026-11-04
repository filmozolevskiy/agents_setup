/**
 * Static, obviously-forged tokens used to exercise storefront
 * not-found / link-expired paths on JustFly without depending on a real
 * production booking row.
 *
 * `bookings.id_hash` is a 32-char lowercase hex string. The
 * all-zeros sentinel cannot collide with a genesis-issued hash
 * (which is derived from `(id, salt)` and never lands at all-zeros)
 * so it deterministically routes to the storefront's Not Found
 * surface on every brand × environment.
 */
export const FORGED_ID_HASH_ZEROS = '00000000000000000000000000000000' as const;

/**
 * Catch-all fallback ref for `/flight/booking/{ref}` that does not
 * resolve to any real booking. The storefront renders the legacy
 * "link expired" surface for any unrecognised ref.
 */
export const FORGED_BOOKING_REF_NO_MATCH = 'forged-ref-no-match-12345' as const;
