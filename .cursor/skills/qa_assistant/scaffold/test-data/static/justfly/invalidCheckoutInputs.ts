/**
 * Curated per-field validation expectations for the JustFly checkout
 * form (`/checkout/billing/flight/.../...`).
 *
 * Each row pairs a passenger / ticket-delivery field key with a human
 * description used in the test step name. The expected error message
 * itself is owned by the page object — `JustflyCheckoutPage`'s
 * `validationErrorFor(field)` returns the locator pinned to the
 * captured `Messages.CHECKOUT_*_REQUIRED` string.
 *
 * Drives the data-driven validation loop in
 * `tests/justfly/functional/checkout.spec.ts`.
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

/**
 * Probe value used to verify the "Invalid email address" validation
 * branch on the ticket-delivery email field — RFC-5321-invalid because
 * it lacks both `@` and a domain.
 */
export const INVALID_EMAIL_PROBE = 'not-an-email';

/**
 * Real-looking partial street address used to verify the Google Places
 * autocomplete dropdown wired to the billing-address field. Kept as a
 * named constant rather than inline so the probe is shared between the
 * spec and any future debugging utilities.
 */
export const BILLING_ADDRESS_PROBE = '100 Bloor St';
