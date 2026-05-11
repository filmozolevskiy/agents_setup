import { test, expect } from '@playwright/test';
import {
    BookingInputsSchema,
    mergeWithFactoryDefaults,
    parseFromCli,
    type BookingInputs,
    type NormalizedBookingInputs,
} from '../../fixtures/helper/bookingInputs';
import {
    searchInputsFromBookingInputs as flighthubSearchInputs,
    generatePassengersFromBookingInputs as flighthubPassengers,
    generatePassportsFromBookingInputs as flighthubPassports,
} from '../../test-data/factories/flighthub/search.factory';
import {
    searchInputsFromBookingInputs as justflySearchInputs,
    generatePassengersFromBookingInputs as justflyPassengers,
} from '../../test-data/factories/justfly/search.factory';

/*
 * Unit-style verification of the BookingInputs surface. No Playwright,
 * no DB, no network — but the spec runs under Playwright Test so it
 * inherits the same CLI runner, reporter, and CI setup as the rest of
 * the suite. Lives under `tests/unit/` and only the `unit` project
 * (no `setup-*` dependency) picks it up.
 */

const ROUND_TRIP_OFFSET = 30;
const TRIP_LENGTH = 10;

function isoDateOffset(daysFromNow: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysFromNow);
    return date.toISOString().slice(0, 10);
}

const DEPART_DATE = isoDateOffset(ROUND_TRIP_OFFSET);
const RETURN_DATE = isoDateOffset(ROUND_TRIP_OFFSET + TRIP_LENGTH);

test.describe('parseFromCli', () => {
    test('parses primitive flags with `=` and space forms', () => {
        const argv = [
            '--brand=flighthub',
            '--env',
            'staging2',
            '--mode=api',
            '--trip-type',
            'oneway',
            '--cabin',
            'economy',
            '--currency=usd',
            '--pos',
            'us',
            '--content-source',
            'amadeus',
            '--carrier=ac',
        ];
        const raw = parseFromCli(argv);
        const parsed = BookingInputsSchema.parse(raw);
        expect(parsed).toMatchObject({
            brand: 'flighthub',
            env: 'staging2',
            mode: 'api',
            tripType: 'oneway',
            fareType: 'economy',
            currency: 'USD',
            pos: 'US',
            contentSource: 'amadeus',
            carrier: 'AC',
        });
    });

    test('aggregates `--pax-*` and `--route-*` into nested records', () => {
        const argv = [
            '--trip-type',
            'roundtrip',
            '--pax-adt',
            '2',
            '--pax-chd',
            '1',
            '--pax-inf-seat',
            '1',
            '--pax-inf-lap',
            '0',
            '--route-origin',
            'yul',
            '--route-dest',
            'lhr',
            '--route-depart',
            DEPART_DATE,
            '--route-return',
            RETURN_DATE,
        ];
        const raw = parseFromCli(argv);
        const parsed = BookingInputsSchema.parse(raw);
        expect(parsed.pax).toEqual({
            adt: 2,
            chd: 1,
            infSeat: 1,
            infLap: 0,
        });
        expect(parsed.route).toEqual({
            origin: 'YUL',
            dest: 'LHR',
            depart: DEPART_DATE,
            return: RETURN_DATE,
        });
    });

    test('parses JSON `--pax`, `--route`, and overrides', () => {
        const argv = [
            '--pax',
            JSON.stringify({ adt: 2, chd: 1 }),
            '--route',
            JSON.stringify({ origin: 'yul', dest: 'lax', depart: DEPART_DATE }),
            '--passenger-overrides',
            JSON.stringify([{ firstName: 'Test' }]),
            '--payment-overrides',
            JSON.stringify({ cardNumber: '4242424242424242' }),
            '--passport-overrides',
            JSON.stringify([{ nationality: 'ca' }]),
        ];
        const parsed = BookingInputsSchema.parse(parseFromCli(argv));
        // PaxCountsSchema's per-field `.default(0)` fires even under
        // `.partial()` for keys that were not supplied — leaving the
        // consumer with a fully resolved counts object.
        expect(parsed.pax).toEqual({
            adt: 2,
            chd: 1,
            infSeat: 0,
            infLap: 0,
        });
        expect(parsed.route).toMatchObject({
            origin: 'YUL',
            dest: 'LAX',
            depart: DEPART_DATE,
        });
        expect(parsed.passengerOverrides).toEqual([{ firstName: 'Test' }]);
        expect(parsed.paymentOverrides).toEqual({
            cardNumber: '4242424242424242',
        });
        expect(parsed.passportOverrides).toEqual([{ nationality: 'CA' }]);
    });

    test('aliases `staging` → `staging2` for back-compat with the Python runners', () => {
        const parsed = BookingInputsSchema.parse(
            parseFromCli(['--env', 'staging'])
        );
        expect(parsed.env).toBe('staging2');
    });
});

test.describe('BookingInputsSchema validation', () => {
    test('rejects 4-letter "airport" codes', () => {
        const raw = parseFromCli([
            '--route-origin',
            'YULL',
            '--route-dest',
            'LAX',
            '--route-depart',
            DEPART_DATE,
        ]);
        expect(() => BookingInputsSchema.parse(raw)).toThrow(
            /3-letter IATA airport code/
        );
    });

    test('rejects unknown brand', () => {
        expect(() =>
            BookingInputsSchema.parse(parseFromCli(['--brand', 'wegolo']))
        ).toThrow();
    });

    test('rejects `--carrier` with non-IATA shape', () => {
        expect(() =>
            BookingInputsSchema.parse(parseFromCli(['--carrier', 'AIRC']))
        ).toThrow(/2-character IATA carrier code/);
    });

    test('rejects mutually exclusive `contentSource` + `packageIndex`', () => {
        const raw = parseFromCli([
            '--content-source',
            'amadeus',
            '--package-index',
            '3',
        ]);
        expect(() => BookingInputsSchema.parse(raw)).toThrow(
            /mutually exclusive/
        );
    });

    test('rejects `roundtrip` with no return date', () => {
        const raw = parseFromCli([
            '--trip-type',
            'roundtrip',
            '--route-origin',
            'YUL',
            '--route-dest',
            'LHR',
            '--route-depart',
            DEPART_DATE,
        ]);
        expect(() => BookingInputsSchema.parse(raw)).toThrow(
            /route\.return.*required/
        );
    });

    test('rejects unknown CLI flags via `.strict()`', () => {
        const raw = parseFromCli(['--brand', 'flighthub']);
        // smuggle an unknown key onto the parsed record:
        (raw as Record<string, unknown>).bogus = 'x';
        expect(() => BookingInputsSchema.parse(raw)).toThrow();
    });
});

test.describe('mergeWithFactoryDefaults', () => {
    test('fills the standard defaults when input is empty', () => {
        const norm = mergeWithFactoryDefaults({});
        expect(norm).toMatchObject({
            brand: 'flighthub',
            env: 'staging2',
            mode: 'api',
            tripType: 'oneway',
            fareType: 'economy',
            pax: { adt: 1, chd: 0, infSeat: 0, infLap: 0 },
            currency: 'CAD',
            pos: 'CA',
            passengerOverrides: [],
            paymentOverrides: {},
            passportOverrides: [],
        });
    });

    test('preserves explicit values', () => {
        const validated: BookingInputs = BookingInputsSchema.parse(
            parseFromCli([
                '--brand',
                'justfly',
                '--mode',
                'ui-headed',
                '--currency',
                'CAD',
            ])
        );
        const norm = mergeWithFactoryDefaults(validated);
        expect(norm.brand).toBe('justfly');
        expect(norm.mode).toBe('ui-headed');
        expect(norm.currency).toBe('CAD');
    });
});

const matrix: ReadonlyArray<{
    name: string;
    argv: readonly string[];
    expectedPaxTotal: number;
}> = [
    {
        name: 'oneway × economy × 1ADT × USD × Amadeus',
        argv: [
            '--brand',
            'flighthub',
            '--trip-type',
            'oneway',
            '--cabin',
            'economy',
            '--pax-adt',
            '1',
            '--currency',
            'USD',
            '--content-source',
            'amadeus',
            '--route-origin',
            'YUL',
            '--route-dest',
            'JFK',
            '--route-depart',
            DEPART_DATE,
        ],
        expectedPaxTotal: 1,
    },
    {
        name: 'roundtrip × business × 2ADT+1CHD+1INFSEAT × CAD × Tripstack',
        argv: [
            '--brand',
            'flighthub',
            '--trip-type',
            'roundtrip',
            '--cabin',
            'business',
            '--pax-adt',
            '2',
            '--pax-chd',
            '1',
            '--pax-inf-seat',
            '1',
            '--currency',
            'CAD',
            '--content-source',
            'tripstack',
            '--route-origin',
            'YUL',
            '--route-dest',
            'LHR',
            '--route-depart',
            DEPART_DATE,
            '--route-return',
            RETURN_DATE,
        ],
        expectedPaxTotal: 4,
    },
    {
        name: 'oneway × economy × 1ADT × failure_injection=cc-decline',
        argv: [
            '--brand',
            'flighthub',
            '--trip-type',
            'oneway',
            '--pax-adt',
            '1',
            '--failure-injection',
            'cc-decline',
            '--route-origin',
            'YUL',
            '--route-dest',
            'JFK',
            '--route-depart',
            DEPART_DATE,
        ],
        expectedPaxTotal: 1,
    },
];

test.describe('parse → validate → merge → factory round trip', () => {
    for (const row of matrix) {
        test(`flighthub: ${row.name}`, () => {
            const norm = roundTrip(row.argv);
            const search = flighthubSearchInputs(norm);
            expect(search.origin).toMatch(/^[A-Z]{3}$/);
            expect(search.destination).toMatch(/^[A-Z]{3}$/);
            expect(search.adults).toBe(norm.pax.adt);
            expect(search.children).toBe(norm.pax.chd);
            expect(search.infants).toBe(
                norm.pax.infSeat + norm.pax.infLap
            );
            expect(search.infantsOnSeat).toBe(norm.pax.infSeat);
            expect(search.infantsOnLap).toBe(norm.pax.infLap);
            if (norm.tripType === 'roundtrip') {
                expect(search.returnDate).toBe(norm.route?.return);
            } else {
                expect(search.returnDate).toBeUndefined();
            }

            const passengers = flighthubPassengers(norm);
            expect(passengers).toHaveLength(row.expectedPaxTotal);
            for (const p of passengers) {
                expect(p.firstName).toBeTruthy();
                expect(p.lastName).toBeTruthy();
            }

            const passports = flighthubPassports(norm);
            expect(passports).toHaveLength(row.expectedPaxTotal);
        });

        test(`justfly: ${row.name}`, () => {
            const norm = roundTrip(
                row.argv.map((tok) =>
                    tok === 'flighthub' ? 'justfly' : tok
                )
            );
            const search = justflySearchInputs(norm);
            expect(search.adults).toBe(norm.pax.adt);
            expect(search.children).toBe(norm.pax.chd);
            const passengers = justflyPassengers(norm);
            expect(passengers).toHaveLength(row.expectedPaxTotal);
        });
    }

    test('passenger overrides land at the right index', () => {
        const argv = [
            '--brand',
            'flighthub',
            '--trip-type',
            'roundtrip',
            '--pax-adt',
            '2',
            '--pax-chd',
            '1',
            '--route-origin',
            'YUL',
            '--route-dest',
            'LHR',
            '--route-depart',
            DEPART_DATE,
            '--route-return',
            RETURN_DATE,
            '--passenger-overrides',
            JSON.stringify([
                { firstName: 'Adult0' },
                { firstName: 'Adult1' },
                { firstName: 'Child0' },
            ]),
        ];
        const norm = roundTrip(argv);
        const passengers = flighthubPassengers(norm);
        expect(passengers[0].firstName).toBe('Adult0');
        expect(passengers[1].firstName).toBe('Adult1');
        expect(passengers[2].firstName).toBe('Child0');
    });

    test('multi-city throws from the factory (not yet wired)', () => {
        const argv = [
            '--brand',
            'flighthub',
            '--trip-type',
            'multi-city',
            '--route-origin',
            'YUL',
            '--route-dest',
            'LHR',
            '--route-depart',
            DEPART_DATE,
        ];
        const norm = roundTrip(argv);
        expect(() => flighthubSearchInputs(norm)).toThrow(/multi-city/);
    });
});

function roundTrip(argv: readonly string[]): NormalizedBookingInputs {
    const parsed = BookingInputsSchema.parse(parseFromCli(argv));
    return mergeWithFactoryDefaults(parsed);
}
