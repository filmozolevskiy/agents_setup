import { z } from 'zod';

/*
 * BookingInputs — the typed parameter surface that every per-phase
 * runner (qa-search / qa-checkout / qa-book / qa-validate / qa-cleanup)
 * imports to validate its CLI flags before doing anything else.
 *
 * This module is pure: no Playwright, no DB, no network, no orchestration.
 *
 *   1. `parseFromCli(argv)` parses a `process.argv.slice(2)`-style array
 *      into a raw, untyped `Record<string, unknown>`.
 *   2. `BookingInputsSchema` validates that record into a typed
 *      `BookingInputs`, applying field-level normalisation (uppercase
 *      airport codes, ISO date shape, IATA carrier shape, mutual
 *      exclusion of `contentSource` and `packageIndex`).
 *   3. `mergeWithFactoryDefaults()` fills the optional surfaces with
 *      named defaults so a downstream factory always sees a fully
 *      resolved `NormalizedBookingInputs`.
 *
 * Carrier semantics: when `--carrier` is specified, it ALWAYS means the
 * marketing/validating carrier (qa_assistant SKILL rule). That semantic
 * is documented on the `carrier` field but NOT enforced inside this
 * module. The agent enforces it at validation time once the booking
 * lands; this module only checks the IATA shape.
 */

// ---------------------------------------------------------------------------
// Domain enums — exported alongside the schema so per-phase runners can
// import a single source of truth for CLI help text and switch-case
// branches.
// ---------------------------------------------------------------------------

export const BRANDS = ['flighthub', 'justfly'] as const;
export type Brand = (typeof BRANDS)[number];

// "staging" is the legacy alias the CLI accepts and normalises to "staging2".
// Any "stagingN" (staging1, staging2, staging99, …) and "production" are valid.
export type Environment = string; // 'production' | `staging${number}`

export const MODES = ['api', 'ui-headless', 'ui-headed'] as const;
export type Mode = (typeof MODES)[number];

export const TRIP_TYPES = ['oneway', 'roundtrip', 'multi-city'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const FARE_TYPES = [
    'economy',
    'premium-economy',
    'business',
    'first',
] as const;
export type FareType = (typeof FARE_TYPES)[number];

// Genesis Debug Filter slugs we recognise today. The schema accepts any
// string so a freshly-rolled-out content source does not block the CLI
// before this list is updated; the typed enum is the recommended path.
export const KNOWN_CONTENT_SOURCES = [
    'amadeus',
    'tripstack',
    'downtowntravel',
    'unififi',
    'kiwi',
    'navitaire-ndc',
    'summit',
] as const;
export type KnownContentSource = (typeof KNOWN_CONTENT_SOURCES)[number];

// Genesis Debugging Options labels. Same forward-compat story as
// `contentSource` — the schema accepts any string but the typed list is
// the recommended path.
export const KNOWN_FAILURE_INJECTIONS = [
    'cc-decline',
    'fraud',
    'fare-increase',
    'flight-not-available',
] as const;
export type KnownFailureInjection = (typeof KNOWN_FAILURE_INJECTIONS)[number];

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const iataAirport = z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'must be a 3-letter IATA airport code')
    .transform((s) => s.toUpperCase());

const iataCarrier = z
    .string()
    .regex(/^[A-Za-z0-9]{2}$/, 'must be a 2-character IATA carrier code')
    .transform((s) => s.toUpperCase());

const isoDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO YYYY-MM-DD');

const currencyCode = z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'must be a 3-letter ISO-4217 currency code')
    .transform((s) => s.toUpperCase());

const countryCode = z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'must be a 2-letter ISO-3166 country code')
    .transform((s) => s.toUpperCase());

const PaxCountsSchema = z.object({
    adt: z.number().int().min(0).max(9).default(1),
    chd: z.number().int().min(0).max(9).default(0),
    infSeat: z.number().int().min(0).max(9).default(0),
    infLap: z.number().int().min(0).max(9).default(0),
});

const RouteLegSchema = z.object({
    origin: iataAirport,
    dest: iataAirport,
    depart: isoDate,
    return: isoDate.optional(),
    autocompleteHint: z.string().min(1).optional(),
});

// `Partial`-style schemas for pass-through overrides. The factories own
// field semantics — this module only checks that the shape is JSON-y.
const PassengerOverrideSchema = z
    .object({
        title: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        dateOfBirth: isoDate.optional(),
        nationality: countryCode.optional(),
        passportNumber: z.string().optional(),
        passportExpiry: isoDate.optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
    })
    .strict();

const PaymentOverrideSchema = z
    .object({
        cardholderName: z.string().optional(),
        cardNumber: z.string().optional(),
        expiryMonth: z.string().optional(),
        expiryYear: z.string().optional(),
        cvv: z.string().optional(),
        billingAddressLine1: z.string().optional(),
        billingCity: z.string().optional(),
        billingPostalCode: z.string().optional(),
        billingCountry: countryCode.optional(),
        billingPhone: z.string().optional(),
    })
    .strict();

const PassportOverrideSchema = z
    .object({
        nationality: countryCode.optional(),
        passportNumber: z.string().optional(),
        passportExpiry: isoDate.optional(),
        passportIssuingCountry: countryCode.optional(),
    })
    .strict();

export const BookingInputsSchema = z
    .object({
        brand: z.enum(BRANDS).optional(),
        env: z
            .string()
            .refine(
                v => v === 'production' || v === 'staging' || /^staging\d+$/.test(v),
                { message: 'env must be "production" or "stagingN" (e.g. "staging2", "staging99")' }
            )
            .transform((v): Environment => (v === 'staging' ? 'staging2' : v))
            .optional(),
        mode: z.enum(MODES).optional(),
        tripType: z.enum(TRIP_TYPES).optional(),
        fareType: z.enum(FARE_TYPES).optional(),
        pax: PaxCountsSchema.partial().optional(),
        currency: currencyCode.optional(),
        pos: countryCode.optional(),

        /**
         * Genesis Debug Filter content-source slug. Mutually exclusive
         * with `packageIndex` — set one, the other, or neither, never
         * both. Free-string escape hatch keeps forward-compat for new
         * sources rolled out before `KNOWN_CONTENT_SOURCES` is updated.
         */
        contentSource: z.string().min(1).optional(),

        /**
         * Debug Filter office id (e.g. `TFCAD`, `TFVALCCAD`,
         * `YKXC42100`). When set, qa-book pins the storefront Office ID
         * dropdown AND asserts the resulting booking row's
         * `gds_account_id` matches case-insensitively. Mostly used with
         * `contentSource` to pin to a specific supplier office (e.g.
         * `--content-source travelfusion --office-id TFCAD`); valid on
         * its own when the user wants to test a single office without
         * narrowing the supplier.
         */
        officeId: z
            .string()
            .min(1)
            .regex(/^[A-Z0-9]+$/, 'must be uppercase alphanumeric (e.g. TFCAD, YKXC42100)')
            .optional(),

        /**
         * Marketing/validating-carrier IATA code (2-letter, e.g. "AC",
         * "BA"). The qa_assistant SKILL rule "When `--carrier` is
         * specified, it always means the marketing/validating carrier"
         * is documented here but NOT enforced inside this module — the
         * agent enforces it at validation time after the booking
         * lands. This module only checks the IATA shape.
         */
        carrier: iataCarrier.optional(),

        /** Mutually exclusive with `contentSource`. */
        packageIndex: z.number().int().min(0).optional(),

        route: RouteLegSchema.optional(),

        failureInjection: z.string().min(1).optional(),

        passengerOverrides: z.array(PassengerOverrideSchema).optional(),
        paymentOverrides: PaymentOverrideSchema.optional(),
        passportOverrides: z.array(PassportOverrideSchema).optional(),
    })
    .strict()
    .refine(
        (v) => !(v.contentSource !== undefined && v.packageIndex !== undefined),
        {
            message:
                '`contentSource` and `packageIndex` are mutually exclusive — set one, neither, never both.',
            path: ['packageIndex'],
        }
    )
    .refine(
        (v) => {
            if (v.tripType !== 'roundtrip') return true;
            return !!v.route?.return;
        },
        {
            message: '`route.return` is required when `tripType="roundtrip"`.',
            path: ['route', 'return'],
        }
    )
    .refine(
        (v) => {
            if (!v.route?.return) return true;
            return v.route.return >= v.route.depart;
        },
        {
            message: '`route.return` must be on or after `route.depart`.',
            path: ['route', 'return'],
        }
    );

export type BookingInputs = z.infer<typeof BookingInputsSchema>;

// Output of `mergeWithFactoryDefaults()`. Every field the agent
// commonly reads is non-optional; sparse fields (`route`, `carrier`,
// `failureInjection`, ...) stay optional because the per-phase runner
// decides at call time whether to require them.
export interface NormalizedBookingInputs {
    brand: Brand;
    env: Environment;
    mode: Mode;
    tripType: TripType;
    fareType: FareType;
    pax: { adt: number; chd: number; infSeat: number; infLap: number };
    currency: string;
    pos: string;
    contentSource?: string;
    officeId?: string;
    carrier?: string;
    packageIndex?: number;
    route?: BookingInputs['route'];
    failureInjection?: string;
    passengerOverrides: NonNullable<BookingInputs['passengerOverrides']>;
    paymentOverrides: NonNullable<BookingInputs['paymentOverrides']>;
    passportOverrides: NonNullable<BookingInputs['passportOverrides']>;
}

// ---------------------------------------------------------------------------
// CLI argv parser — a small, dependency-free `--key value` / `--key=value`
// reader. JSON-typed fields (`pax`, `route`, `*-overrides`) accept a
// JSON-encoded string; primitive fields accept a literal value.
// ---------------------------------------------------------------------------

/**
 * Parses a `process.argv.slice(2)`-style array into a raw, untyped
 * record. The output is meant to be fed into `BookingInputsSchema.parse`.
 *
 * Supported flag forms:
 *   --brand=flighthub
 *   --brand flighthub
 *   --pax-adt=2 --pax-chd=1 --pax-inf-seat=1 --pax-inf-lap=0
 *   --route-origin YUL --route-dest LHR --route-depart 2026-06-15
 *   --route-return 2026-06-25 --route-hint "Pierre Elliott Trudeau Intl"
 *   --pax='{"adt":2,"chd":1}'
 *   --route='{"origin":"YUL","dest":"LHR","depart":"2026-06-15"}'
 *   --passenger-overrides='[{"firstName":"Test"}]'
 *   --payment-overrides='{"cardNumber":"4242424242424242"}'
 *   --passport-overrides='[{"nationality":"CA"}]'
 *
 * Unknown flags are preserved on the output record under their raw
 * camel-cased key so the schema's `.strict()` mode can reject them with
 * a precise error rather than silently discarding.
 *
 * @param argv - Argument vector (typically `process.argv.slice(2)`).
 * @returns A raw record ready for `BookingInputsSchema.parse`.
 */
export function parseFromCli(argv: readonly string[]): Record<string, unknown> {
    const flags = readFlags(argv);
    const out: Record<string, unknown> = {};

    // ----- direct primitive flags ------------------------------------------
    if ('brand' in flags) out.brand = flags.brand;
    if ('env' in flags) out.env = flags.env;
    if ('mode' in flags) out.mode = flags.mode;
    if ('trip-type' in flags) out.tripType = flags['trip-type'];
    if ('fare-type' in flags) out.fareType = flags['fare-type'];
    if ('cabin' in flags) out.fareType = flags.cabin;
    if ('currency' in flags) out.currency = flags.currency;
    if ('pos' in flags) out.pos = flags.pos;
    if ('content-source' in flags) out.contentSource = flags['content-source'];
    if ('office-id' in flags) out.officeId = flags['office-id'];
    if ('carrier' in flags) out.carrier = flags.carrier;
    if ('package-index' in flags) {
        out.packageIndex = toIntOrPassThrough(flags['package-index']);
    }
    if ('failure-injection' in flags) {
        out.failureInjection = flags['failure-injection'];
    }

    // ----- pax: aggregated --pax JSON or per-component --pax-* -------------
    let pax: Record<string, unknown> | undefined;
    if ('pax' in flags) {
        pax = parseJsonField('pax', flags.pax) as Record<string, unknown>;
    }
    for (const [key, dst] of [
        ['pax-adt', 'adt'],
        ['pax-chd', 'chd'],
        ['pax-inf-seat', 'infSeat'],
        ['pax-inf-lap', 'infLap'],
    ] as const) {
        if (key in flags) {
            pax = pax ?? {};
            pax[dst] = toIntOrPassThrough(flags[key]);
        }
    }
    if (pax !== undefined) out.pax = pax;

    // ----- route: aggregated --route JSON or per-component --route-* -------
    let route: Record<string, unknown> | undefined;
    if ('route' in flags) {
        route = parseJsonField('route', flags.route) as Record<string, unknown>;
    }
    for (const [key, dst] of [
        ['origin', 'origin'],
        ['route-origin', 'origin'],
        ['dest', 'dest'],
        ['route-dest', 'dest'],
        ['depart', 'depart'],
        ['route-depart', 'depart'],
        ['return', 'return'],
        ['route-return', 'return'],
        ['route-hint', 'autocompleteHint'],
    ] as const) {
        if (key in flags) {
            route = route ?? {};
            route[dst] = flags[key];
        }
    }
    if (route !== undefined) out.route = route;

    // ----- overrides: JSON only -------------------------------------------
    if ('passenger-overrides' in flags) {
        out.passengerOverrides = parseJsonField(
            'passenger-overrides',
            flags['passenger-overrides']
        );
    }
    if ('payment-overrides' in flags) {
        out.paymentOverrides = parseJsonField(
            'payment-overrides',
            flags['payment-overrides']
        );
    }
    if ('passport-overrides' in flags) {
        out.passportOverrides = parseJsonField(
            'passport-overrides',
            flags['passport-overrides']
        );
    }

    return out;
}

/**
 * Fills a validated `BookingInputs` with named defaults so a downstream
 * factory always sees a fully resolved record.
 *
 * Defaults:
 *   brand            → `flighthub`
 *   env              → `staging2`
 *   mode             → `api`
 *   tripType         → `oneway`
 *   fareType         → `economy`
 *   pax              → 1 ADT, 0 of everything else
 *   currency         → `CAD`
 *   pos              → `CA`
 *
 * Sparse fields (`contentSource`, `carrier`, `packageIndex`, `route`,
 * `failureInjection`) stay sparse — the per-phase runner decides at
 * call time whether to require them.
 *
 * @param inputs - A validated `BookingInputs` (post-schema).
 * @returns A fully-resolved `NormalizedBookingInputs`.
 */
export function mergeWithFactoryDefaults(
    inputs: BookingInputs
): NormalizedBookingInputs {
    return {
        brand: inputs.brand ?? 'flighthub',
        env: inputs.env ?? 'staging2',
        mode: inputs.mode ?? 'api',
        tripType: inputs.tripType ?? 'oneway',
        fareType: inputs.fareType ?? 'economy',
        pax: {
            adt: inputs.pax?.adt ?? 1,
            chd: inputs.pax?.chd ?? 0,
            infSeat: inputs.pax?.infSeat ?? 0,
            infLap: inputs.pax?.infLap ?? 0,
        },
        currency: inputs.currency ?? 'CAD',
        pos: inputs.pos ?? 'CA',
        contentSource: inputs.contentSource,
        officeId: inputs.officeId,
        carrier: inputs.carrier,
        packageIndex: inputs.packageIndex,
        route: inputs.route,
        failureInjection: inputs.failureInjection,
        passengerOverrides: inputs.passengerOverrides ?? [],
        paymentOverrides: inputs.paymentOverrides ?? {},
        passportOverrides: inputs.passportOverrides ?? [],
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readFlags(argv: readonly string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (!tok.startsWith('--')) continue;
        const eq = tok.indexOf('=');
        if (eq >= 0) {
            flags[tok.slice(2, eq)] = tok.slice(eq + 1);
            continue;
        }
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            // Bare boolean flags are not part of BookingInputs today;
            // record an empty string so the schema can reject them
            // with a precise error.
            flags[key] = '';
            continue;
        }
        flags[key] = next;
        i++;
    }
    return flags;
}

function toIntOrPassThrough(raw: string): number | string {
    const n = Number(raw);
    return Number.isInteger(n) && raw.trim() !== '' ? n : raw;
}

function parseJsonField(name: string, raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(
            `--${name} expects a JSON value but failed to parse: ${reason}`
        );
    }
}
