import { faker } from '@faker-js/faker';

// Per-pax passport block fed to the international-itinerary checkout
// surface. Fields are inferred from the storefront's per-pax passport
// section visible on routes that require travel documents (e.g.
// transatlantic). The block does not always render on staging2 — see
// the `JustflyCheckoutPage.passportBlockVisible` action used by tests
// to skip with FIXME when the storefront elides it.
export interface JustflyPassport {
    nationality: string;
    passportNumber: string;
    passportExpiry: string;
    passportIssuingCountry: string;
}

function isoDateYearsAhead(yearsAhead: number): string {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + yearsAhead);
    return d.toISOString().slice(0, 10);
}

/**
 * Generates a valid passport block for an international itinerary.
 *
 * @param overrides - Optional partial overrides for any passport field.
 * @returns A fully-populated `JustflyPassport`.
 */
export function generatePassport(
    overrides?: Partial<JustflyPassport>
): JustflyPassport {
    const defaults: JustflyPassport = {
        nationality: 'CA',
        passportNumber: faker.string.alphanumeric({
            length: 9,
            casing: 'upper',
        }),
        passportExpiry: isoDateYearsAhead(faker.number.int({ min: 2, max: 8 })),
        passportIssuingCountry: 'CA',
    };

    return { ...defaults, ...overrides };
}
