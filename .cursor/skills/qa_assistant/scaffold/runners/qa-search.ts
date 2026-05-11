#!/usr/bin/env node
/**
 * qa-search — Search phase runner.
 *
 * API mode (--mode api, the default):
 *   Calls /storefront-api/search-init then polls
 *   /storefront-api/search-result-fetch until packages arrive or the
 *   90-second budget is exhausted. No browser is launched.
 *
 * UI mode (--mode ui-headless / ui-headed):
 *   Navigates to the genesis search URL, waits for results via the POM,
 *   intercepts the search-init response to capture transaction_id, and
 *   enumerates visible packages.
 *
 * Stdout: single JSON object.
 * Stderr: progress logs.
 *
 * Usage (API mode — default):
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npx tsx runners/qa-search.ts \
 *     --origin YUL --dest LAX --depart 2026-08-01
 *
 * Usage (UI mode):
 *   npx tsx runners/qa-search.ts \
 *     --mode ui-headless \
 *     --origin YUL --dest LAX --depart 2026-08-01 \
 *     --label amadeus-smoke
 */

import { loadEnv } from './_lib/envLoader';
import { emitOk, emitError, log } from './_lib/stdout';
import { createScenarioDir, scenarioPath } from './_lib/scenarioDir';
import { launchBrowser } from './_lib/browser';
import { createApiContext, apiGet } from './_lib/apiRequest';
import {
    parseFromCli,
    BookingInputsSchema,
    mergeWithFactoryDefaults,
} from '../fixtures/helper/bookingInputs';
import type { NormalizedBookingInputs, Mode } from '../fixtures/helper/bookingInputs';
import { FlighthubSearchResultsPage } from '../pages/flighthub/searchResults.page';
import { JustflySearchResultsPage } from '../pages/justfly/searchResults.page';

const MAX_PACKAGES = 20;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 90_000;

// Mapping fareType → genesis seat_class value (for search-init API param).
const CABIN_TO_SEAT_CLASS: Record<string, string> = {
    economy: 'Economy',
    'premium-economy': 'EconomyPremium',
    business: 'Business',
    first: 'First',
};

// Mapping fareType → single-letter cabin code (for /flight/search URL).
const CABIN_TO_URL_CODE: Record<string, string> = {
    economy: 'Y',
    'premium-economy': 'W',
    business: 'C',
    first: 'F',
};

interface PackageSummary {
    index: number;
    package_id?: string;
    total_display: string;
    total?: number;
    currency?: string;
    validating_carrier: string;
    tags?: string[];
    is_multiticket?: boolean;
}

interface FetchPackage {
    tags: string[];
    price: { total: number; currency: string };
    validating_carrier: string;
    is_multiticket: boolean;
}

interface FetchBody {
    completed: boolean;
    all_package_count: number;
    packages: Record<string, FetchPackage> | never[];
}

type UiMode = Exclude<Mode, 'api'>;

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const raw = parseFromCli(argv);

    // Pull runner-level flags that are not part of BookingInputsSchema.
    const labelFlag = raw['label'] as string | undefined;
    const maxPackagesFlag = raw['max-packages'] as string | undefined;
    const maxPackages = maxPackagesFlag ? parseInt(maxPackagesFlag, 10) : MAX_PACKAGES;
    delete raw['label'];
    delete (raw as Record<string, unknown>)['max-packages'];

    const parseResult = BookingInputsSchema.safeParse(raw);
    if (!parseResult.success) {
        emitError('invalid_inputs', { detail: parseResult.error.format() });
    }

    const inputs = mergeWithFactoryDefaults(parseResult.data);

    if (!inputs.route) {
        emitError('missing_route', {
            detail: '--origin, --dest, --depart are required for qa-search.',
        });
    }

    let loadedEnv;
    try {
        loadedEnv = loadEnv(`${inputs.brand}-${inputs.env}`);
    } catch (e) {
        emitError('env_load_failed', { detail: String(e) });
    }
    const { appUrl, brand } = loadedEnv;

    const label =
        labelFlag ?? `search-${inputs.route!.origin}-${inputs.route!.dest}`;
    const scenarioDir = createScenarioDir(label);

    log(`brand=${brand} env=${inputs.env} mode=${inputs.mode}`);
    log(
        `route: ${inputs.route!.origin}→${inputs.route!.dest} depart=${inputs.route!.depart}`
    );
    log(`scenarioDir: ${scenarioDir}`);

    // Build the /flight/search URL (shared output field for qa-book handoff).
    const tripType = inputs.tripType === 'roundtrip' ? 'roundtrip' : 'oneway';
    const urlParams = new URLSearchParams({
        type: tripType,
        seat_class: CABIN_TO_URL_CODE[inputs.fareType] ?? 'Y',
        seg0_from: inputs.route!.origin,
        seg0_to: inputs.route!.dest,
        seg0_date: inputs.route!.depart,
        num_adults: String(inputs.pax.adt),
        num_children: String(inputs.pax.chd),
        // Storefront treats num_infants and num_infants_lap as additive buckets
        // (seat infants + lap infants). Passing infSeat+infLap in num_infants
        // double-counts lap infants and triggers "infants > adults" validation.
        num_infants: String(inputs.pax.infSeat),
        num_infants_lap: String(inputs.pax.infLap),
    });
    if (inputs.tripType === 'roundtrip' && inputs.route!.return) {
        urlParams.set('seg1_date', inputs.route!.return);
        urlParams.set('seg1_from', inputs.route!.dest);
        urlParams.set('seg1_to', inputs.route!.origin);
    }
    const searchUrl = `${appUrl}/flight/search?${urlParams.toString()}`;

    if (inputs.mode === 'api') {
        await runApiMode({
            inputs,
            appUrl,
            brand,
            searchUrl,
            scenarioDir,
            maxPackages,
            tripType,
        });
        return;
    }

    await runUiMode({
        inputs,
        mode: inputs.mode as UiMode,
        appUrl,
        brand,
        searchUrl,
        scenarioDir,
        maxPackages,
    });
}

async function runApiMode({
    inputs,
    appUrl,
    brand,
    searchUrl,
    scenarioDir,
    maxPackages,
    tripType,
}: {
    inputs: NormalizedBookingInputs;
    appUrl: string;
    brand: string;
    searchUrl: string;
    scenarioDir: string;
    maxPackages: number;
    tripType: string;
}): Promise<void> {
    // Build search-init query params using genesis seat_class values.
    const initParams = new URLSearchParams({
        type: tripType,
        seat_class: CABIN_TO_SEAT_CLASS[inputs.fareType] ?? 'Economy',
        seg0_from: inputs.route!.origin,
        seg0_to: inputs.route!.dest,
        seg0_date: inputs.route!.depart,
        num_adults: String(inputs.pax.adt),
        num_children: String(inputs.pax.chd),
        num_infants: String(inputs.pax.infSeat),
        num_infants_lap: String(inputs.pax.infLap),
        surfer_id: `qa-runner-${Date.now()}`,
    });
    if (tripType === 'roundtrip' && inputs.route!.return) {
        initParams.set('seg1_date', inputs.route!.return);
        initParams.set('seg1_from', inputs.route!.dest);
        initParams.set('seg1_to', inputs.route!.origin);
    }

    const apiSession = await createApiContext(appUrl);
    try {
        // Step 1: search-init.
        const initResp = await apiGet(
            apiSession.ctx,
            `/storefront-api/search-init?${initParams.toString()}`
        );
        if (initResp.status !== 200) {
            emitError('search_init_failed', {
                status: initResp.status,
                body: initResp.body,
            });
        }

        const initBody = initResp.body as {
            search_id: string | null;
            np_si?: boolean;
        };
        const searchId = initBody.search_id;
        if (!searchId) {
            emitError('search_init_null_id', {
                detail:
                    'search-init returned search_id: null — check route params.',
                params: initParams.toString(),
            });
        }
        log(`search_id: ${searchId}`);

        // Step 2: poll search-result-fetch.
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let packages: PackageSummary[] = [];
        let completed = false;
        let pollCount = 0;

        while (Date.now() < deadline) {
            pollCount++;
            const fetchResp = await apiGet(
                apiSession.ctx,
                `/storefront-api/search-result-fetch/${searchId}`
            );
            if (fetchResp.status !== 200) {
                emitError('search_result_fetch_failed', {
                    status: fetchResp.status,
                    body: fetchResp.body,
                });
            }

            const fetchBody = fetchResp.body as FetchBody;
            completed = fetchBody.completed;

            if (!Array.isArray(fetchBody.packages)) {
                packages = Object.entries(fetchBody.packages).map(
                    ([id, pkg], idx) => ({
                        index: idx,
                        package_id: id,
                        total_display: `${pkg.price.currency} ${pkg.price.total.toFixed(2)}`,
                        total: pkg.price.total,
                        currency: pkg.price.currency,
                        validating_carrier: pkg.validating_carrier,
                        tags: pkg.tags,
                        is_multiticket: pkg.is_multiticket,
                    })
                );
            }

            log(
                `poll ${pollCount}: completed=${completed} packages=${packages.length}`
            );

            if (completed || packages.length >= maxPackages) break;

            await new Promise<void>((resolve) => {
                setTimeout(resolve, POLL_INTERVAL_MS);
            });
        }

        if (!completed && packages.length === 0) {
            emitError('search_timed_out', {
                detail: `No packages returned after ${POLL_TIMEOUT_MS / 1000}s.`,
                search_id: searchId,
                search_url: searchUrl,
                polls: pollCount,
            });
        }

        emitOk({
            scenario_dir: scenarioDir,
            env: inputs.env,
            brand,
            base_url: appUrl,
            search_url: searchUrl,
            search_id: searchId,
            trip_type: inputs.tripType,
            origin: inputs.route!.origin,
            dest: inputs.route!.dest,
            depart: inputs.route!.depart,
            return: inputs.route!.return ?? null,
            pax: {
                adt: inputs.pax.adt,
                chd: inputs.pax.chd,
                infSeat: inputs.pax.infSeat,
                infLap: inputs.pax.infLap,
            },
            transaction_id: searchId,
            completed,
            packages: packages.slice(0, maxPackages),
            screenshots: [],
        });
    } finally {
        await apiSession.dispose();
    }
}

async function runUiMode({
    inputs,
    mode,
    appUrl,
    brand,
    searchUrl,
    scenarioDir,
    maxPackages,
}: {
    inputs: NormalizedBookingInputs;
    mode: UiMode;
    appUrl: string;
    brand: string;
    searchUrl: string;
    scenarioDir: string;
    maxPackages: number;
}): Promise<void> {
    const session = await launchBrowser(mode);
    let transactionId: string | null = null;

    session.page.on('response', async (response) => {
        if (!response.url().includes('/storefront-api/search-init')) return;
        try {
            const body = await response.json();
            if (body?.search_id) {
                transactionId = body.search_id as string;
                log(`transaction_id captured: ${transactionId}`);
            }
        } catch {
            // ignore parse errors on non-JSON responses
        }
    });

    try {
        log(`navigating to: ${searchUrl}`);
        await session.page.goto(searchUrl);

        const resultsPage =
            brand === 'flighthub'
                ? new FlighthubSearchResultsPage(session.page)
                : new JustflySearchResultsPage(session.page);

        await resultsPage.waitForResults();
        log('results loaded');

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '001-search-results.png'),
            fullPage: false,
        });

        const packages: PackageSummary[] = [];
        const cardCount = await resultsPage.resultCards.count();
        const limit = Math.min(cardCount, maxPackages);

        for (let i = 0; i < limit; i++) {
            const price = await resultsPage.resultCardPrice(i).textContent();
            const carrier = await resultsPage
                .resultCardCarrierName(i)
                .textContent();
            packages.push({
                index: i,
                total_display: (price ?? '').trim(),
                validating_carrier: (carrier ?? '').trim(),
            });
        }

        log(`enumerated ${packages.length} packages`);

        emitOk({
            scenario_dir: scenarioDir,
            env: inputs.env,
            brand,
            base_url: appUrl,
            search_url: searchUrl,
            trip_type: inputs.tripType,
            origin: inputs.route!.origin,
            dest: inputs.route!.dest,
            depart: inputs.route!.depart,
            return: inputs.route!.return ?? null,
            pax: {
                adt: inputs.pax.adt,
                chd: inputs.pax.chd,
                infSeat: inputs.pax.infSeat,
                infLap: inputs.pax.infLap,
            },
            transaction_id: transactionId,
            packages,
            screenshots: ['001-search-results.png'],
        });
    } catch (e) {
        await session.page
            .screenshot({
                path: scenarioPath(scenarioDir, '001-error.png'),
                fullPage: false,
            })
            .catch(() => undefined);
        emitError('unhandled_exception', { detail: String(e) });
    } finally {
        await session.close();
    }
}

main();
