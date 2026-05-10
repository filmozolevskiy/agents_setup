import { faker } from '@faker-js/faker';
import type {
    JustflyCabinClass,
    JustflySearchInputs,
} from '../../../pages/justfly/home.page';

// Well-trafficked airports likely to return inventory on staging2.
const STAGING_FRIENDLY_AIRPORTS = [
    'YUL', // Montreal
    'YYZ', // Toronto
    'JFK', // New York
    'LAX', // Los Angeles
    'MIA', // Miami
    'LAS', // Las Vegas
    'YVR', // Vancouver
    'SFO', // San Francisco
] as const;

const CABIN_CLASSES: readonly JustflyCabinClass[] = [
    'Economy',
    'Premium Economy',
    'Business',
    'First',
] as const;

// Always-future dates — JustFly's search rejects past ones.
function isoDateOffset(daysFromNow: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysFromNow);
    return date.toISOString().slice(0, 10);
}

/**
 * Generates a valid one-way JustFly search payload with random
 * staging-friendly inputs.
 *
 * @param overrides - Optional partial overrides for any field.
 * @returns Fully-populated `JustflySearchInputs`.
 */
export function generateOneWaySearch(
    overrides?: Partial<JustflySearchInputs>
): JustflySearchInputs {
    const [origin, destination] = faker.helpers.arrayElements(
        STAGING_FRIENDLY_AIRPORTS,
        2
    );

    const departureOffset = faker.number.int({ min: 7, max: 60 });

    const defaults: JustflySearchInputs = {
        origin,
        destination,
        departureDate: isoDateOffset(departureOffset),
        cabin: faker.helpers.arrayElement(CABIN_CLASSES),
        adults: faker.number.int({ min: 1, max: 2 }),
        children: 0,
        infants: 0,
    };

    return { ...defaults, ...overrides };
}

/**
 * Generates a valid round-trip search — same as `generateOneWaySearch`
 * plus a `returnDate` 3-14 days after departure.
 *
 * @param overrides - Optional partial overrides for any field.
 * @returns Fully-populated `JustflySearchInputs` with `returnDate` set.
 */
export function generateRoundTripSearch(
    overrides?: Partial<JustflySearchInputs>
): JustflySearchInputs & { returnDate: string } {
    const oneWay = generateOneWaySearch(overrides);

    const tripLength = faker.number.int({ min: 3, max: 14 });
    const departureOffset = Math.round(
        (new Date(oneWay.departureDate).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
    );

    return {
        ...oneWay,
        returnDate:
            overrides?.returnDate ??
            isoDateOffset(departureOffset + tripLength),
    };
}

// Canonical international round-trip used by checkout-form regressions.
// YUL <-> LHR returns inventory on staging2 reliably, exercises the
// per-pax passport block when the storefront chooses to render it, and
// produces a 4-row passenger form (2 ADT + 1 CHD + 1 INF in seat) that
// the existing 1-pax `generateRoundTripSearch` cannot.
const INTL_ORIGIN = 'YUL';
const INTL_DESTINATION = 'LHR';

/**
 * Generates a deterministic international round-trip search payload (YUL
 * to LHR, 2 ADT + 1 CHD + 1 INF in seat). Used by the multi-pax
 * checkout-form regression tests.
 *
 * @param overrides - Optional partial overrides for any field.
 * @returns Fully-populated `JustflySearchInputs` with `returnDate` set.
 */
export function internationalSearchData(
    overrides?: Partial<JustflySearchInputs & { returnDate: string }>
): JustflySearchInputs & { returnDate: string } {
    const departureOffset = 30;
    const tripLength = 10;

    const defaults: JustflySearchInputs & { returnDate: string } = {
        origin: INTL_ORIGIN,
        destination: INTL_DESTINATION,
        departureDate: isoDateOffset(departureOffset),
        returnDate: isoDateOffset(departureOffset + tripLength),
        cabin: 'Economy',
        adults: 2,
        children: 1,
        infants: 1,
    };

    return { ...defaults, ...overrides };
}
