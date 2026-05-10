import { faker } from '@faker-js/faker';
import type {
    FlighthubCabinClass,
    FlighthubSearchInputs,
} from '../../../pages/flighthub/home.page';
import type {
    FareType,
    NormalizedBookingInputs,
} from '../../../fixtures/helper/bookingInputs';
import {
    generateAdultPassenger,
    generateChildPassenger,
    generateInfantPassenger,
    type FlighthubPassenger,
} from './passenger.factory';
import {
    generatePassport,
    type FlighthubPassport,
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

const CABIN_CLASSES: readonly FlighthubCabinClass[] = [
    'Economy',
    'Premium Economy',
    'Business',
    'First',
] as const;

// Always-future dates — Flighthub's search rejects past ones.
function isoDateOffset(daysFromNow: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysFromNow);
    return date.toISOString().slice(0, 10);
}

/**
 * Generates a valid one-way Flighthub search payload with random
 * staging-friendly inputs.
 *
 * @param overrides - Optional partial overrides for any field.
 * @returns Fully-populated `FlighthubSearchInputs`.
 */
export function generateOneWaySearch(
    overrides?: Partial<FlighthubSearchInputs>
): FlighthubSearchInputs {
    const [origin, destination] = faker.helpers.arrayElements(
        STAGING_FRIENDLY_AIRPORTS,
        2
    );

    const departureOffset = faker.number.int({ min: 7, max: 60 });

    const defaults: FlighthubSearchInputs = {
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
 * @returns Fully-populated `FlighthubSearchInputs` with `returnDate` set.
 */
export function generateRoundTripSearch(
    overrides?: Partial<FlighthubSearchInputs>
): FlighthubSearchInputs & { returnDate: string } {
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

const FARE_TYPE_TO_CABIN: Record<FareType, FlighthubCabinClass> = {
    economy: 'Economy',
    'premium-economy': 'Premium Economy',
    business: 'Business',
    first: 'First',
};

/**
 * Maps the FareType slug to the storefront's `FlighthubCabinClass` label.
 *
 * @param fareType - Normalized BookingInputs fare type.
 * @returns The matching FlighthubCabinClass label.
 */
export function fareTypeToCabin(fareType: FareType): FlighthubCabinClass {
    return FARE_TYPE_TO_CABIN[fareType];
}

/**
 * Resolves a `NormalizedBookingInputs` record into a fully-populated
 * `FlighthubSearchInputs` payload.
 *
 * Behaviour by `tripType`:
 *   - `oneway`     → `FlighthubSearchInputs` with no `returnDate`.
 *   - `roundtrip`  → `FlighthubSearchInputs & { returnDate }`.
 *   - `multi-city` → throws. The home-page POM does not yet expose
 *                    multi-city; multi-leg support is tracked on a
 *                    later card on the rebuild epic.
 *
 * Pax counts collapse `infSeat` + `infLap` into the single `infants`
 * field that `FlighthubSearchInputs` exposes today; the per-counter
 * detail is preserved on the returned object's extra
 * `infantsOnSeat` / `infantsOnLap` keys for runners that drive the
 * passengers popover via `FlighthubPassengerCounts`.
 *
 * @param inputs - Normalized BookingInputs (post `mergeWithFactoryDefaults`).
 * @returns FlighthubSearchInputs with optional `returnDate` and
 *   per-counter infant fields.
 */
export function searchInputsFromBookingInputs(
    inputs: NormalizedBookingInputs
): FlighthubSearchInputs & {
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

    const base: FlighthubSearchInputs & {
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
 * pax-type and applying `passengerOverrides[i]` index-aligned to the
 * generated array.
 *
 * Pax-type ordering is the storefront's: ADT first, then CHD, then
 * infant-on-seat, then infant-on-lap. `passengerOverrides[0]` lands on
 * the first ADT row; `passengerOverrides[adt + chd]` lands on the
 * first infant-on-seat row, and so on. Out-of-range overrides are
 * silently ignored — the agent decides at validation time whether a
 * runaway overrides array is an error.
 *
 * @param inputs - Normalized BookingInputs.
 * @returns Index-aligned `FlighthubPassenger[]` of length
 *   `adt + chd + infSeat + infLap`.
 */
export function generatePassengersFromBookingInputs(
    inputs: NormalizedBookingInputs
): FlighthubPassenger[] {
    const out: FlighthubPassenger[] = [];
    const overrides = inputs.passengerOverrides;
    let i = 0;
    for (let n = 0; n < inputs.pax.adt; n++, i++) {
        out.push(generateAdultPassenger(overrides[i]));
    }
    for (let n = 0; n < inputs.pax.chd; n++, i++) {
        out.push(generateChildPassenger(overrides[i]));
    }
    for (let n = 0; n < inputs.pax.infSeat; n++, i++) {
        out.push(generateInfantPassenger(overrides[i]));
    }
    for (let n = 0; n < inputs.pax.infLap; n++, i++) {
        out.push(generateInfantPassenger(overrides[i]));
    }
    return out;
}

/**
 * Builds the per-pax passport array implied by `inputs.pax`, applying
 * `passportOverrides[i]` index-aligned to the generated array. Same
 * pax-type ordering as `generatePassengersFromBookingInputs`. The
 * caller decides whether to render the per-pax passport block at all
 * (the storefront elides it on some itineraries — see
 * `FlighthubCheckoutPage.passportBlockVisible`).
 *
 * @param inputs - Normalized BookingInputs.
 * @returns Index-aligned `FlighthubPassport[]` of length
 *   `adt + chd + infSeat + infLap`.
 */
export function generatePassportsFromBookingInputs(
    inputs: NormalizedBookingInputs
): FlighthubPassport[] {
    const total =
        inputs.pax.adt +
        inputs.pax.chd +
        inputs.pax.infSeat +
        inputs.pax.infLap;
    const out: FlighthubPassport[] = [];
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
 * @returns Fully-populated `FlighthubSearchInputs` with `returnDate` set.
 */
export function internationalSearchData(
    overrides?: Partial<FlighthubSearchInputs & { returnDate: string }>
): FlighthubSearchInputs & { returnDate: string } {
    const departureOffset = 30;
    const tripLength = 10;

    const defaults: FlighthubSearchInputs & { returnDate: string } = {
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
