import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { StorageStatePaths as FlighthubStorageStatePaths } from './enums/flighthub/flighthub';
import { StorageStatePaths as JustflyStorageStatePaths } from './enums/justfly/justfly';

/**
 * Single-file env loader with TARGET-based (brand × environment) switching.
 *
 * The scaffold reads ONE env file (`./env/.env`). The active (brand,
 * environment) pair is selected at run time by the TARGET env var of
 * the form `<brand>-<environment>` — e.g. `TARGET=flighthub-staging2`.
 * Defaults to `flighthub-staging2` (the team does not have a dev
 * environment, so staging2 is the standing default for local runs).
 *
 *   TARGET=flighthub-staging2    npx playwright test --project=flighthub-staging2   # the default
 *   TARGET=flighthub-production  npx playwright test --project=flighthub-production
 *   TARGET=justfly-staging2      npx playwright test --project=justfly-staging2
 *   TARGET=justfly-production    npx playwright test --project=justfly-production
 *
 * Real `env/.env` is gitignored; copy `env/.env.example` to bootstrap.
 *
 * Loader behaviour:
 *   1. Parse and validate TARGET → (brand, environment).
 *   2. dotenv-load `./env/.env` (every key in the file lands in process.env).
 *   3. For every key matching `<BRAND>_<ENV>_<REST>` (uppercased), set
 *      `<BRAND>_<REST>` in process.env. So `FLIGHTHUB_STAGING2_APP_URL`
 *      becomes `FLIGHTHUB_APP_URL` when TARGET=flighthub-staging2 — the
 *      consumer interface (`process.env.FLIGHTHUB_APP_URL` etc.) is
 *      unchanged. Shared keys (`MYSQL_HOST`, `APP_EMAIL`, `RESPRO_*`,
 *      etc.) live unprefixed in the file and are read straight through
 *      by name.
 *   4. Export `process.env.BRAND` and `process.env.ENVIRONMENT` for
 *      helpers that branch on the active brand at runtime (e.g.
 *      `helpers/shared/deactivateCustomer.ts`).
 *
 * Per-(brand, environment) overrides for shared keys are out of scope:
 * the previous two-layer layout documented this but no scaffold env
 * file actually used it. If we ever truly need it, the convention is
 * to define the key brand-prefixed at the top of the file and have the
 * consumer read the brand-prefixed copy; the loader does not synthesise
 * overrides for unprefixed shared keys.
 */
const VALID_BRANDS = ['flighthub', 'justfly'] as const;
const VALID_ENVIRONMENTS = ['staging2', 'production'] as const;

type Brand = (typeof VALID_BRANDS)[number];
type Environment = (typeof VALID_ENVIRONMENTS)[number];

function parseTarget(raw: string): { brand: Brand; environment: Environment } {
    const dashIndex = raw.indexOf('-');
    if (dashIndex === -1) {
        throw new Error(
            `Invalid TARGET="${raw}". Expected "<brand>-<environment>" — e.g. "flighthub-staging2".`
        );
    }
    const brand = raw.slice(0, dashIndex);
    const environment = raw.slice(dashIndex + 1);

    if (!(VALID_BRANDS as readonly string[]).includes(brand)) {
        throw new Error(
            `Invalid TARGET="${raw}". Brand "${brand}" is not one of: ${VALID_BRANDS.join(', ')}.`
        );
    }
    if (!(VALID_ENVIRONMENTS as readonly string[]).includes(environment)) {
        throw new Error(
            `Invalid TARGET="${raw}". Environment "${environment}" is not one of: ${VALID_ENVIRONMENTS.join(', ')}.`
        );
    }
    return { brand: brand as Brand, environment: environment as Environment };
}

const { brand, environment } = parseTarget(
    process.env.TARGET ?? 'flighthub-staging2'
);

dotenv.config({ path: './env/.env' });

const brandUpper = brand.toUpperCase();
const envUpper = environment.toUpperCase();
const targetPrefix = `${brandUpper}_${envUpper}_`;

for (const key of Object.keys(process.env)) {
    if (!key.startsWith(targetPrefix)) continue;
    const expandedKey = `${brandUpper}_${key.slice(targetPrefix.length)}`;
    process.env[expandedKey] = process.env[key];
}

process.env.BRAND = brand;
process.env.ENVIRONMENT = environment;

/**
 * Playwright Test Configuration
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './tests',

    /* Run tests in files in parallel */
    fullyParallel: true,

    /* Fail the build on CI if you accidentally left test.only in the source code */
    forbidOnly: !!process.env.CI,

    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,

    /* Limit parallel workers on CI for stability */
    workers: process.env.CI ? 1 : undefined,

    /* Reporter configuration */
    reporter: process.env.CI
        ? [['blob'], ['html', { open: 'never' }]]
        : [['html', { open: 'on-failure' }]],

    /* Shared settings for all projects */
    use: {
        /* Collect trace when retrying the failed test */
        trace: 'on-first-retry',

        /* Screenshot on failure */
        screenshot: 'only-on-failure',

        /* Video on failure */
        video: 'retain-on-failure',

        /* Action timeout */
        actionTimeout: 10000,

        /* Navigation timeout */
        navigationTimeout: 30000,
    },

    /* Test timeout */
    timeout: 60000,

    /* Expect timeout */
    expect: {
        timeout: 10000,
    },

    /*
     * Project layout
     * ──────────────
     * Four brand-environment named projects (`flighthub-staging2`,
     * `flighthub-production`, `justfly-staging2`, `justfly-production`)
     * plus a per-brand `setup-*` project that produces the brand
     * `storageState`. Each named project uses the TARGET-resolved
     * `<BRAND>_APP_URL`, so the recipe is always
     *   TARGET=<brand>-<env>  npx playwright test --project=<brand>-<env>
     * (the project name and the TARGET value are the same string).
     *
     * `tests/shared/` runs under every brand project so any
     * genesis-backend test exercises both FLIGHTHUB_API_URL and
     * JUSTFLY_API_URL. Brand-scoped tests under `tests/{brand}/` only
     * run under that brand's projects.
     */
    projects: [
        /*
         * Unit-style specs — pure parsers, validators, and factories.
         * No brand auth, no `setup-*` dependency, no `baseURL` /
         * `storageState`. Anything under `tests/unit/` runs here only.
         * Brand-pinned acceptance (`TARGET=...`) does NOT need to be
         * set; the loader's default keeps Playwright happy.
         */
        {
            name: 'unit',
            testMatch: /tests\/unit\/.*\.spec\.ts/,
        },

        /* ── Flighthub ─────────────────────────────────────────────── */
        {
            name: 'setup-flighthub',
            testMatch: /tests\/flighthub\/.*\.setup\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },
            },
        },
        {
            name: 'flighthub-staging2',
            testMatch: /tests\/(flighthub|shared)\/.*\.spec\.ts/,
            dependencies: ['setup-flighthub'],
            use: {
                ...devices['Desktop Chrome'],
                baseURL: process.env.FLIGHTHUB_APP_URL,
                storageState: FlighthubStorageStatePaths.FLIGHTHUB,
                viewport: { width: 1920, height: 1080 },
            },
        },
        {
            name: 'flighthub-production',
            testMatch: /tests\/(flighthub|shared)\/.*\.spec\.ts/,
            dependencies: ['setup-flighthub'],
            use: {
                ...devices['Desktop Chrome'],
                baseURL: process.env.FLIGHTHUB_APP_URL,
                storageState: FlighthubStorageStatePaths.FLIGHTHUB,
                viewport: { width: 1920, height: 1080 },
            },
        },

        /* ── JustFly ───────────────────────────────────────────────── */
        {
            name: 'setup-justfly',
            testMatch: /tests\/justfly\/.*\.setup\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1920, height: 1080 },
            },
        },
        {
            name: 'justfly-staging2',
            testMatch: /tests\/(justfly|shared)\/.*\.spec\.ts/,
            dependencies: ['setup-justfly'],
            use: {
                ...devices['Desktop Chrome'],
                baseURL: process.env.JUSTFLY_APP_URL,
                storageState: JustflyStorageStatePaths.JUSTFLY,
                viewport: { width: 1920, height: 1080 },
            },
        },
        {
            name: 'justfly-production',
            testMatch: /tests\/(justfly|shared)\/.*\.spec\.ts/,
            dependencies: ['setup-justfly'],
            use: {
                ...devices['Desktop Chrome'],
                baseURL: process.env.JUSTFLY_APP_URL,
                storageState: JustflyStorageStatePaths.JUSTFLY,
                viewport: { width: 1920, height: 1080 },
            },
        },
    ],
});
