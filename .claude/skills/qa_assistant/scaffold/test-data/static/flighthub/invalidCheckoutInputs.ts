/**
 * Curated per-field validation expectations for the Flighthub checkout
 * form (`/checkout/billing/flight/.../...`).
 *
 * Each row pairs a passenger / ticket-delivery field key with a human
 * description used in the test step name. The expected error message
 * itself is owned by the page object — `FlighthubCheckoutPage`'s
 * `validationErrorFor(field)` returns the locator pinned to the
 * captured `Messages.CHECKOUT_*_REQUIRED` string. Captured 2026-05-04
 * via playwright-cli on staging2.
 *
 * Drives the data-driven validation loop in
 * `tests/flighthub/functional/checkout.spec.ts`.
 *
 * `as const` is required: it narrows `field` to a literal-union type so
 * `validationErrorFor` rejects unknown field keys at compile time.
 */

export const EMPTY_FORM_VALIDATION_CASES = [
    { field: 'firstName', description: 'first name is empty' },
    { field: 'surname', description: 'surname is empty' },
    { field: 'dateOfBirth', description: 'date of birth is empty' },
    { field: 'gender', description: 'gender is not selected' },
    { field: 'phone', description: 'phone number is empty' },
    { field: 'email', description: 'email is empty' },
] as const;

export type EmptyFormValidationField =
    (typeof EMPTY_FORM_VALIDATION_CASES)[number]['field'];
