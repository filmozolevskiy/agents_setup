import { faker } from '@faker-js/faker';

/**
 * Faker-backed factories for the genesis Storefront API auth and account
 * endpoints (`check-email`, `customer-sign-up`, `login-init`, `login-process`,
 * `password-forgot-process`, `resend-totp`).
 *
 * All factories return values that the live API accepts as syntactically
 * valid (genesis password rule: ≥6 chars; emails: any RFC-5322 local-part).
 * The returned data is unique per call so concurrent test workers do not
 * collide. Side effects (creating real customers) are still gated by
 * `@destructive` tags + DB-level cleanup; see the `helpers/shared` skill.
 */

/** Random e-mail under `pwt-<timestamp>-<rand>@example.com` so it is
 * provably never seen by genesis (no production traffic uses example.com). */
export function unseenEmail(scope = 'pwt'): string {
    return `${scope}_unseen_${Date.now()}_${faker.string.alphanumeric({
        length: 8,
        casing: 'lower',
    })}@example.com`;
}

/**
 * Fresh per-test email under
 * `filipp.mozolevskiy+pwt-<scope>-<timestamp>-<rand>@flighthub.com`
 * for `@destructive` tests that hit `customer-sign-up` and need a real
 * deliverable address that the genesis throttler treats as a normal
 * customer (not the `@example.com` "obviously synthetic" filter).
 *
 * The `+pwt-` plus-alias guarantees:
 *
 *   1. **Mailbox routing** — every test run still reaches one human
 *      inbox (`filipp.mozolevskiy@flighthub.com`) so TOTP / welcome
 *      emails stay diagnosable.
 *   2. **Brand-agnostic** — the same alias works on both Flighthub and
 *      JustFly (genesis isolates brands by `customers.site_id`, not by
 *      email domain).
 *   3. **Backfill grep** — every test customer is matchable in
 *      `ota.customers` via `email LIKE 'filipp.mozolevskiy+pwt-%'` for
 *      the periodic CMS-purge backfill we file on the Trello backlog.
 *
 * Pair with {@link deactivateCustomer} in an `afterEach` hook so the
 * row is left as `active = 0` rather than leaking as `active = 1`
 * forever.
 */
export function pwtSignupEmail(scope = 'signup'): string {
    return `filipp.mozolevskiy+pwt-${scope}-${Date.now()}-${faker.string.alphanumeric(
        { length: 6, casing: 'lower' }
    )}@flighthub.com`;
}

/** A password that satisfies genesis's `≥ 6 characters` rule. Does not
 * include genesis's stricter "uppercase + digit + special" UI hint
 * because the API accepts the looser rule per `actionCustomerSignUp`. */
export function validPassword(): string {
    return `${faker.internet.password({ length: 12 })}`;
}

/** A 6-digit numeric TOTP placeholder. Real TOTPs come from a side
 * channel (db-access skill or mailbox); use this only when the test
 * intentionally targets the `wrong-TOTP` failure branch. */
export function validTotp(): string {
    return faker.string.numeric({ length: 6 });
}

/** First / last names matching genesis's `1..50 char` constraint. */
export function personName(): { first_name: string; last_name: string } {
    return {
        first_name: faker.person.firstName(),
        last_name: faker.person.lastName(),
    };
}

/** Surfer id used for the `Surferid` header — randomized per call so the
 * genesis throttler does not cross-pollute concurrent test runs. */
export function surferId(scope = 'pwt'): string {
    return `${scope}_${faker.string.alphanumeric({ length: 20, casing: 'lower' })}`;
}
