import { faker } from '@faker-js/faker';

// Field set verified against the live `/checkout/billing/flight/...`
// payment surface on staging2 (Trello e3Uq1uUp). The storefront rejects
// the classic 4111... Visa stub; the Stripe-style 4242... test card is
// accepted by the staging tokenizer without producing a real charge.
export interface JustflyPayment {
    cardholderName: string;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    cvv: string;
    billingAddressLine1: string;
    billingCity: string;
    billingPostalCode: string;
    billingCountry: string;
    billingPhone: string;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/**
 * Generates a valid-looking payment payload for staging2 (no real charge).
 *
 * @param overrides - Optional partial overrides for any payment field.
 * @returns A fully-populated `JustflyPayment`.
 */
export function generateStagingPayment(
    overrides?: Partial<JustflyPayment>
): JustflyPayment {
    const expiryYear =
        new Date().getUTCFullYear() +
        faker.number.int({
            min: 1,
            max: 5,
        });

    const defaults: JustflyPayment = {
        cardholderName: faker.person.fullName(),
        // Stripe test BIN 4242 is the only Visa staging's tokenizer accepts.
        // Cardholder name + email + CVV are faker-randomized so the Fraud
        // Prevention API treats each run as a distinct cardholder; expect
        // intermittent declines if many runs land within minutes of each
        // other.
        cardNumber: '4242424242424242',
        expiryMonth: pad2(faker.number.int({ min: 1, max: 12 })),
        expiryYear: String(expiryYear),
        cvv: faker.string.numeric(3),
        billingAddressLine1: faker.location.streetAddress(),
        billingCity: faker.location.city(),
        billingPostalCode: faker.location.zipCode('A1A 1A1'),
        billingCountry: 'CA',
        // 10-digit national number — billing phone shares the same
        // inline validator as the passenger phone, which rejects E.164.
        billingPhone: `514${faker.string.numeric(7)}`,
    };

    return { ...defaults, ...overrides };
}
