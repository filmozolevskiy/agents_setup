#!/usr/bin/env node
/**
 * qa-search — Search phase runner.
 *
 * UI mode (--mode ui-headless / ui-headed):
 *   Navigates directly to the genesis search URL (built from --origin /
 *   --dest / --depart / trip-type flags), waits for results, enumerates
 *   visible packages, and captures the transaction_id by intercepting the
 *   search-init network request.
 *
 * API mode (--mode api, the default):
 *   Calls search-init → polls search-result-fetch until packages arrive
 *   or the budget is exhausted. No browser is launched. See Card 5
 *   (zutcAJq7) which wires up the API path; this file exposes the UI
 *   path only (Card 4).
 *
 * Stdout: single JSON object.
 * Stderr: progress logs.
 * Exit 0 on success, non-zero on error.
 *
 * Usage (UI mode):
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npx tsx runners/qa-search.ts \
 *     --mode ui-headless \
 *     --origin YUL --dest LAX --depart 2026-08-01 \
 *     --trip-type oneway \
 *     --label amadeus-smoke
 */

import { loadEnv } from './_lib/envLoader';
import { emitOk, emitError, log } from './_lib/stdout';
import { createScenarioDir, scenarioPath } from './_lib/scenarioDir';
import { launchBrowser } from './_lib/browser';
import {
    parseFromCli,
    BookingInputsSchema,
    mergeWithFactoryDefaults,
} from '../fixtures/helper/bookingInputs';

import { FlighthubHomePage } from '../pages/flighthub/home.page';
import { JustflyHomePage } from '../pages/justfly/home.page';
import { FlighthubSearchResultsPage } from '../pages/flighthub/searchResults.page';
import { JustflySearchResultsPage } from '../pages/justfly/searchResults.page';

const MAX_PACKAGES = 20;

async function main(): Promise<void> {
    const argv = process.argv.slice(2);

    const raw = parseFromCli(argv);
    // Pull --label and --max-packages before schema validation (they're
    // not part of BookingInputs but are runner-level flags).
    const labelFlag = raw['label'] as string | undefined;
    const maxPackagesFlag = raw['max-packages'] as string | undefined;
    const maxPackages = maxPackagesFlag ? parseInt(maxPackagesFlag, 10) : MAX_PACKAGES;
    delete raw['label'];
    delete (raw as Record<string, unknown>)['max-packages'];

    const parseResult = BookingInputsSchema.safeParse(raw);
    if (!parseResult.success) {
        emitError('invalid_inputs', {
            detail: parseResult.error.format(),
        });
    }

    const inputs = mergeWithFactoryDefaults(parseResult.data);

    if (inputs.mode === 'api') {
        emitError('api_mode_not_in_card4', {
            detail:
                'API mode is implemented in Card 5 (zutcAJq7). Pass --mode ui-headless or --mode ui-headed for this runner.',
        });
    }

    if (!inputs.route) {
        emitError('missing_route', {
            detail:
                '--origin, --dest, --depart are required for qa-search.',
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
        labelFlag ??
        `search-${inputs.route!.origin}-${inputs.route!.dest}`;
    const scenarioDir = createScenarioDir(label);

    log(`brand=${brand} env=${inputs.env} mode=${inputs.mode}`);
    log(`route: ${inputs.route!.origin}→${inputs.route!.dest} depart=${inputs.route!.depart}`);
    log(`scenarioDir: ${scenarioDir}`);

    const session = await launchBrowser(inputs.mode);
    let transactionId: string | null = null;

    // Intercept search-init response to capture transaction_id (search_id).
    session.page.on('response', async (response) => {
        if (!response.url().includes('/storefront-api/search-init')) return;
        try {
            const body = await response.json();
            if (body?.search_id) {
                transactionId = body.search_id as string;
                log(`transaction_id captured: ${transactionId}`);
            }
        } catch {
            // Ignore parse errors on non-JSON responses.
        }
    });

    try {
        // Build the search URL from inputs (mirrors FlighthubHomePage.buildSearchUrl
        // but done here so we don't need a page to build a URL).
        const cabinMap: Record<string, string> = {
            economy: 'Y',
            'premium-economy': 'W',
            business: 'C',
            first: 'F',
        };
        const seatClass = cabinMap[inputs.fareType] ?? 'Y';
        const tripType =
            inputs.tripType === 'roundtrip' ? 'roundtrip' : 'oneway';
        const params = new URLSearchParams({
            type: tripType,
            seat_class: seatClass,
            seg0_from: inputs.route!.origin,
            seg0_to: inputs.route!.dest,
            seg0_date: inputs.route!.depart,
            num_adults: String(inputs.pax.adt),
            num_children: String(inputs.pax.chd),
            num_infants: String(inputs.pax.infSeat + inputs.pax.infLap),
            num_infants_lap: String(inputs.pax.infLap),
        });
        if (inputs.tripType === 'roundtrip' && inputs.route!.return) {
            params.set('seg1_date', inputs.route!.return);
            params.set('seg1_from', inputs.route!.dest);
            params.set('seg1_to', inputs.route!.origin);
        }
        const searchPath = '/flight/search';
        const searchUrl = `${appUrl}${searchPath}?${params.toString()}`;
        log(`navigating to: ${searchUrl}`);

        await session.page.goto(searchUrl);

        // Wait for results using the brand POM.
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

        // Enumerate packages: iterate result cards up to maxPackages.
        const packages: Array<{
            index: number;
            total_display: string;
            validating_carrier: string;
        }> = [];

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
