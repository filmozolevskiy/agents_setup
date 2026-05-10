import { faker } from '@faker-js/faker';
import type {
    JustflyCabinClass,
    JustflySearchInputs,
} from '../../../pages/justfly/home.page';
import type {
    FareType,
    NormalizedBookingInputs,
} from '../../../fixtures/helper/bookingInputs';
import {
    generateAdultPassenger,
    generateChildPassenger,
    generateInfantPassenger,
    type JustflyPassenger,
} from './passenger.factory';
import {
    generatePassport,
    type JustflyPassport,
} from './passport.factory';

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

// ---------------------------------------------------------------------------
// BookingInputs → factory output (pure helpers)
// ---------------------------------------------------------------------------

const FARE_TYPE_TO_CABIN: Record<FareType, JustflyCabinClass> = {
    economy: 'Economy',
    'premium-economy': 'Premium Economy',
    business: 'Business',
    first: 'First',
};

/**
 * Maps the FareType slug to the storefront's `JustflyCabinClass` label.
 *
 * @param fareType - Normalized BookingInputs fare type.
 * @returns The matching JustflyCabinClass label.
 */
export function fareTypeToCabin(fareType: FareType): JustflyCabinClass {
    return FARE_TYPE_TO_CABIN[fareType];
}

/**
 * Resolves a `NormalizedBookingInputs` record into a fully-populated
 * `JustflySearchInputs` payload. See the Flighthub mirror for the full
 * behaviour contract — this function is intentionally identical.
 *
 * @param inputs - Normalized BookingInputs (post `mergeWithFactoryDefaults`).
 * @returns JustflySearchInputs with optional `returnDate` and per-counter
 *   infant fields.
 */
export function searchInputsFromBookingInputs(
    inputs: NormalizedBookingInputs
): JustflySearchInputs & {
    returnDate?: string;
    infantsOnSeat: number;
    infantsOnLap: number;
} {
    if (inputs.tripType === 'multi-city') {
        throw new Error(
            'searchInputsFromBookingInputs: multi-city is not yet wired through the home-page POM; tracked on the per-phase UI runners card.'
        );
    }

    const route = inputs.route;
    if (!route) {
        throw new Error(
            'searchInputsFromBookingInputs: `route` is required (origin, dest, depart, optionally return).'
        );
    }

    const base: JustflySearchInputs & {
        infantsOnSeat: number;
        infantsOnLap: number;
    } = {
        origin: route.origin,
        destination: route.dest,
        departureDate: route.depart,
        cabin: fareTypeToCabin(inputs.fareType),
        adults: inputs.pax.adt,
        children: inputs.pax.chd,
        infants: inputs.pax.infSeat + inputs.pax.infLap,
        infantsOnSeat: inputs.pax.infSeat,
        infantsOnLap: inputs.pax.infLap,
    };

    if (inputs.tripType === 'roundtrip') {
        if (!route.return) {
            throw new Error(
                'searchInputsFromBookingInputs: `route.return` is required when `tripType="roundtrip"`.'
            );
        }
        return { ...base, returnDate: route.return };
    }

    return base;
}

/**
 * Builds the per-pax passenger array implied by
 * `NormalizedBookingInputs.pax`, using `passenger.factory` for each
 * pax-type and applying `passengerOverrides[i]` index-aligned. Same
 * pax-type ordering and out-of-range semantics as the Flighthub mirror.
 *
 * @param inputs - Normalized BookingInputs.
 * @returns Index-aligned `JustflyPassenger[]` of length
 *   `adt + chd + infSeat + infLap`.
 */
export function generatePassengersFromBookingInputs(
    inputs: NormalizedBookingInputs
): JustflyPassenger[] {
    const out: JustflyPassenger[] = [];
    const overrides = inputs.passengerOverrides;
    let i = 0;
    for (let n = 0; n < inputs.pax.adt; n++, i++) {
        out.push(generateAdultPassenger(overrides[i] as Partial<JustflyPassenger>));
    }
    for (let n = 0; n < inputs.pax.chd; n++, i++) {
        out.push(generateChildPassenger(overrides[i] as Partial<JustflyPassenger>));
    }
    for (let n = 0; n < inputs.pax.infSeat; n++, i++) {
        out.push(generateInfantPassenger(overrides[i] as Partial<JustflyPassenger>));
    }
    for (let n = 0; n < inputs.pax.infLap; n++, i++) {
        out.push(generateInfantPassenger(overrides[i] as Partial<JustflyPassenger>));
    }
    return out;
}

/**
 * Builds the per-pax passport array implied by `inputs.pax`, applying
 * `passportOverrides[i]` index-aligned. Same pax-type ordering as the
 * Flighthub mirror.
 *
 * @param inputs - Normalized BookingInputs.
 * @returns Index-aligned `JustflyPassport[]` of length
 *   `adt + chd + infSeat + infLap`.
 */
export function generatePassportsFromBookingInputs(
    inputs: NormalizedBookingInputs
): JustflyPassport[] {
    const total =
        inputs.pax.adt +
        inputs.pax.chd +
        inputs.pax.infSeat +
        inputs.pax.infLap;
    const out: JustflyPassport[] = [];
    for (let i = 0; i < total; i++) {
        out.push(generatePassport(inputs.passportOverrides[i]));
    }
    return out;
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
