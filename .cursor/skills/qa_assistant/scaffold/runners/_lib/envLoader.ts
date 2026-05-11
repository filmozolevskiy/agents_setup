import dotenv from 'dotenv';
import * as path from 'node:path';
import * as url from 'node:url';

const VALID_BRANDS = ['flighthub', 'justfly'] as const;

type Brand = (typeof VALID_BRANDS)[number];
type Environment = string; // 'production' | `staging${number}`

function isValidEnvironment(env: string): boolean {
    return env === 'production' || /^staging\d+$/.test(env);
}

export interface LoadedEnv {
    brand: Brand;
    environment: Environment;
    appUrl: string;
    apiUrl: string;
}

/**
 * Mirrors the TARGET-based env-loading logic in `playwright.config.ts`
 * so runners launched outside the Playwright test runner see the same
 * env-var expansions (`FLIGHTHUB_STAGING2_APP_URL` → `FLIGHTHUB_APP_URL`
 * when `TARGET=flighthub-staging2`).
 *
 * Runners are run from the scaffold root: `npx tsx runners/qa-search.ts …`
 * so `./env/.env` is relative to `process.cwd()` which equals the scaffold
 * root when invoked that way.
 */
export function loadEnv(target?: string): LoadedEnv {
    const targetStr =
        target ?? process.env.TARGET ?? 'flighthub-staging2';

    const dashIndex = targetStr.lastIndexOf('-');
    if (dashIndex < 0) {
        throw new Error(
            `Invalid TARGET="${targetStr}". Expected "<brand>-<environment>" e.g. "flighthub-staging2".`
        );
    }

    const brand = targetStr.slice(0, dashIndex) as Brand;
    const environment = targetStr.slice(dashIndex + 1) as Environment;

    if (!(VALID_BRANDS as readonly string[]).includes(brand)) {
        throw new Error(
            `Invalid brand "${brand}". Must be one of: ${VALID_BRANDS.join(', ')}.`
        );
    }
    if (!isValidEnvironment(environment)) {
        throw new Error(
            `Invalid environment "${environment}". Must be "production" or "stagingN" (e.g. "staging2", "staging99").`
        );
    }

    dotenv.config({ path: path.resolve(process.cwd(), '../../../../.env') });

    const brandUpper = brand.toUpperCase();
    // .env keys use PROD (not PRODUCTION) as the environment segment.
    const envUpper = environment === 'production' ? 'PROD' : environment.toUpperCase();
    const targetPrefix = `${brandUpper}_${envUpper}_`;

    for (const key of Object.keys(process.env)) {
        if (!key.startsWith(targetPrefix)) continue;
        const expandedKey = `${brandUpper}_${key.slice(targetPrefix.length)}`;
        process.env[expandedKey] = process.env[key];
    }

    process.env.BRAND = brand;
    process.env.ENVIRONMENT = environment;

    const brandKey = brandUpper;
    const appUrl = process.env[`${brandKey}_APP_URL`] ?? '';
    const apiUrl = process.env[`${brandKey}_API_URL`] ?? '';

    if (!appUrl) {
        throw new Error(
            `${brandKey}_APP_URL is not set after loading env for TARGET="${targetStr}". ` +
                'Populate .env at the repo root (copy .env.example).'
        );
    }

    return { brand, environment, appUrl, apiUrl };
}
