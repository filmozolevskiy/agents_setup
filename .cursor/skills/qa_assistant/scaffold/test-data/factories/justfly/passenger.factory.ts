import { faker } from '@faker-js/faker';

// Field set inferred from the storefront passenger DTO; verify against
// a live checkout snapshot before unskipping the @destructive E2E.
export interface JustflyPassenger {
    title: 'Mr' | 'Mrs' | 'Ms' | 'Mx';
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    nationality: string;
    passportNumber: string;
    passportExpiry: string;
    email: string;
    phone: string;
}

function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function isoDateYearsAgo(yearsAgo: number): string {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - yearsAgo);
    return isoDate(d);
}

function isoDateYearsAhead(yearsAhead: number): string {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + yearsAhead);
    return isoDate(d);
}

/**
 * Generates a valid adult passenger (random name, DOB ~30 years ago,
 * passport with a future expiry).
 *
 * @param overrides - Optional partial overrides for any passenger field.
 * @returns A fully-populated adult `JustflyPassenger`.
 */
export function generateAdultPassenger(
    overrides?: Partial<JustflyPassenger>
): JustflyPassenger {
    const defaults: JustflyPassenger = {
        title: faker.helpers.arrayElement(['Mr', 'Mrs', 'Ms', 'Mx']),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        dateOfBirth: isoDateYearsAgo(faker.number.int({ min: 25, max: 55 })),
        nationality: 'CA',
        passportNumber: faker.string.alphanumeric({
            length: 9,
            casing: 'upper',
        }),
        passportExpiry: isoDateYearsAhead(faker.number.int({ min: 2, max: 8 })),
        email: faker.internet.email(),
        // Storefront expects a 10-digit national number; international /
        // E.164 forms are rejected by inline phone validation. NANP exchange
        // (digits 4-6) must start with 2-9; faker.string.numeric can emit 0/1.
        phone: `514${faker.number.int({ min: 2, max: 9 })}${faker.string.numeric(6)}`,
    };

    return { ...defaults, ...overrides };
}

/**
 * Generates a valid child passenger (DOB 4-11 years ago).
 *
 * @param overrides - Optional partial overrides for any passenger field.
 * @returns A fully-populated child `JustflyPassenger`.
 */
export function generateChildPassenger(
    overrides?: Partial<JustflyPassenger>
): JustflyPassenger {
    return generateAdultPassenger({
        dateOfBirth: isoDateYearsAgo(faker.number.int({ min: 4, max: 11 })),
        ...overrides,
    });
}

/**
 * Generates a valid infant passenger (DOB 0-1 years ago).
 *
 * The JustFly storefront enforces "infant must be under 2 at the
 * departure time of the last flight" via its trip-info form
 * validation; with `max: 2` here, an infant born exactly two years
 * ago is already 25+ months on a typical 30-50 day-out trip date,
 * which silently rejects the "Continue to payment" click. Bound at 1
 * year to leave headroom for any reasonable trip offset (and for
 * `isoDateYearsAgo` rolling year-over-year on a leap day).
 *
 * @param overrides - Optional partial overrides for any passenger field.
 * @returns A fully-populated infant `JustflyPassenger`.
 */
export function generateInfantPassenger(
    overrides?: Partial<JustflyPassenger>
): JustflyPassenger {
    return generateAdultPassenger({
        dateOfBirth: isoDateYearsAgo(faker.number.int({ min: 0, max: 1 })),
        ...overrides,
    });
}
