#!/usr/bin/env node
/**
 * qa-checkout — Checkout phase runner (Card 4: UI mode only).
 *
 * Re-opens a `search_url` from `qa-search` output, picks a package by
 * content-source slug (staging2 Debug Filter) or by 0-based index, fills
 * the passenger / passport / payment form, and returns the checkout URL
 * that was active when "Continue to payment" was reached.
 *
 * This runner stops *before* "Confirm and Book". Use `qa-book` for the
 * full search → checkout → confirm flow, or chain this runner's
 * `checkout_url` output into `qa-book --search-url <checkout_url>` (not
 * yet supported — one-card-per-phase is the intended agent workflow).
 *
 * Stdout: single JSON object.
 * Stderr: progress logs.
 *
 * Usage:
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npx tsx runners/qa-checkout.ts \
 *     --mode ui-headless \
 *     --search-url "https://staging2.flighthub.com/flight/search?..." \
 *     --content-source amadeus \
 *     --scenario-dir reports/20260801-120000-amadeus-smoke
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
import {
    searchInputsFromBookingInputs,
    generatePassengersFromBookingInputs,
    generatePassportsFromBookingInputs,
} from '../test-data/factories/flighthub/search.factory';
import { generateStagingPayment } from '../test-data/factories/flighthub/payment.factory';
import {
    generateAdultPassenger,
    type FlighthubPassenger,
} from '../test-data/factories/flighthub/passenger.factory';
import {
    generatePassport,
    type FlighthubPassport,
} from '../test-data/factories/flighthub/passport.factory';
import { FlighthubSearchResultsPage } from '../pages/flighthub/searchResults.page';
import { JustflySearchResultsPage } from '../pages/justfly/searchResults.page';
import { FlighthubCheckoutPage } from '../pages/flighthub/checkout.page';
import { JustflyCheckoutPage } from '../pages/justfly/checkout.page';

// Flags not part of BookingInputs schema.
interface RunnerFlags {
    searchUrl?: string;
    scenarioDir?: string;
    label?: string;
}

function extractRunnerFlags(
    argv: string[]
): { flags: RunnerFlags; remaining: string[] } {
    const flags: RunnerFlags = {};
    const remaining: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (tok === '--search-url') {
            flags.searchUrl = argv[++i];
        } else if (tok.startsWith('--search-url=')) {
            flags.searchUrl = tok.slice('--search-url='.length);
        } else if (tok === '--scenario-dir') {
            flags.scenarioDir = argv[++i];
        } else if (tok.startsWith('--scenario-dir=')) {
            flags.scenarioDir = tok.slice('--scenario-dir='.length);
        } else if (tok === '--label') {
            flags.label = argv[++i];
        } else if (tok.startsWith('--label=')) {
            flags.label = tok.slice('--label='.length);
        } else {
            remaining.push(tok);
        }
    }

    return { flags, remaining };
}

async function main(): Promise<void> {
    const { flags, remaining } = extractRunnerFlags(process.argv.slice(2));

    if (!flags.searchUrl) {
        emitError('missing_search_url', {
            detail: '--search-url is required (from qa-search output.search_url).',
        });
    }

    const raw = parseFromCli(remaining);
    const parseResult = BookingInputsSchema.safeParse(raw);
    if (!parseResult.success) {
        emitError('invalid_inputs', { detail: parseResult.error.format() });
    }

    const inputs = mergeWithFactoryDefaults(parseResult.data);

    if (inputs.mode === 'api') {
        emitError('api_mode_requires_ui', {
            detail:
                'qa-checkout drives the checkout form, which requires a browser. Pass --mode ui-headless or --mode ui-headed.',
        });
    }

    // Infer brand/env from the search URL host when TARGET isn't set.
    let brand = inputs.brand;
    let env = inputs.env;
    const searchUrlHost = new URL(flags.searchUrl!).hostname;
    if (searchUrlHost.includes('justfly')) brand = 'justfly';
    else if (searchUrlHost.includes('flighthub')) brand = 'flighthub';
    if (searchUrlHost.startsWith('www.')) env = 'production';
    else env = 'staging2';

    let loadedEnv;
    try {
        loadedEnv = loadEnv(`${brand}-${env}`);
    } catch (e) {
        emitError('env_load_failed', { detail: String(e) });
    }

    const label = flags.label ?? `checkout-${inputs.contentSource ?? 'pkg'}`;
    const scenarioDir =
        flags.scenarioDir ?? createScenarioDir(label);

    log(`brand=${brand} env=${env} mode=${inputs.mode}`);
    log(`search_url: ${flags.searchUrl}`);
    log(`content_source: ${inputs.contentSource ?? '(none)'}`);
    log(`package_index: ${inputs.packageIndex ?? '(none)'}`);
    log(`scenarioDir: ${scenarioDir}`);

    const session = await launchBrowser(inputs.mode);

    try {
        await session.page.goto(flags.searchUrl!);

        // Wait for results.
        const resultsPage =
            brand === 'flighthub'
                ? new FlighthubSearchResultsPage(session.page)
                : new JustflySearchResultsPage(session.page);
        await resultsPage.waitForResults();

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '001-search-results.png'),
            fullPage: false,
        });

        // Disable optimizer when content-source is pinned (mirrors Python runner).
        if (inputs.contentSource && brand === 'flighthub') {
            // On staging2 the Debug Filter dropdown exists. Filter to the source.
            // eslint-disable-next-line playwright/no-raw-locators
            const filterSelect = session.page.locator('select#gds');
            if ((await filterSelect.count()) > 0) {
                const optionValue = inputs.contentSource;
                const matchingOption = filterSelect.locator('option').filter({ hasText: new RegExp(optionValue, 'i') });
                const selectedValue = (await matchingOption.count()) > 0
                    ? (await matchingOption.first().getAttribute('value') ?? optionValue)
                    : optionValue;
                await filterSelect.selectOption(selectedValue).catch(() => undefined);
                log(`debug filter set to: ${inputs.contentSource}`);
                // Re-wait for results after filter change.
                await resultsPage.waitForResults();
            }
        }

        // Pick a package.
        if (inputs.packageIndex !== undefined) {
            await resultsPage.resultCardSelectButton(inputs.packageIndex).click();
            await resultsPage.handlePostSelectModals();
        } else {
            await resultsPage.selectFirstResult();
        }

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '002-after-select.png'),
            fullPage: false,
        });

        // Wait for checkout URL.
        await session.page.waitForURL(/\/checkout\/billing\/flight\//, {
            timeout: 30000,
        });
        const checkoutUrl = session.page.url();
        log(`checkout URL: ${checkoutUrl}`);

        const checkoutPage =
            brand === 'flighthub'
                ? new FlighthubCheckoutPage(session.page)
                : new JustflyCheckoutPage(session.page);

        // Disable optimizer/repricer on staging when pinning a content source.
        if (inputs.contentSource && brand === 'flighthub') {
            await (checkoutPage as FlighthubCheckoutPage)
                .setOptimizerDisabled(true)
                .catch(() => undefined);
        }

        // Inject failure reason if specified.
        if (inputs.failureInjection && brand === 'flighthub') {
            const fhCheckout = checkoutPage as FlighthubCheckoutPage;
            const failureOption = fhCheckout.bookingFailureReasonSelect
                .locator('option')
                .filter({ hasText: new RegExp(inputs.failureInjection, 'i') });
            const failureValue = (await failureOption.count()) > 0
                ? (await failureOption.first().getAttribute('value') ?? inputs.failureInjection)
                : inputs.failureInjection;
            await fhCheckout.bookingFailureReasonSelect
                .selectOption(failureValue)
                .catch(() => undefined);
            log(`failure injection set: ${inputs.failureInjection}`);
        }

        // Build passenger list from inputs.
        let passengers: FlighthubPassenger[];
        if (inputs.route) {
            passengers = generatePassengersFromBookingInputs({
                ...inputs,
                brand,
                env,
            });
        } else {
            passengers = [generateAdultPassenger()];
        }

        // Fill passengers.
        for (let idx = 0; idx < passengers.length; idx++) {
            await (checkoutPage as FlighthubCheckoutPage).fillPassenger(
                idx + 1,
                passengers[idx]
            );
        }

        // Fill passports if block is visible.
        if (brand === 'flighthub') {
            const fhCheckout = checkoutPage as FlighthubCheckoutPage;
            const passports = inputs.route
                ? generatePassportsFromBookingInputs({ ...inputs, brand, env })
                : [generatePassport()];
            for (let idx = 0; idx < passports.length; idx++) {
                if (await fhCheckout.passportBlockVisible(idx + 1)) {
                    await fhCheckout.fillPassport(idx + 1, passports[idx]);
                }
            }
        }

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '003-passenger-filled.png'),
            fullPage: false,
        });

        // Continue to payment.
        await (checkoutPage as FlighthubCheckoutPage).continueToPayment();

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '004-payment-surface.png'),
            fullPage: false,
        });

        // Fill payment.
        const payment = generateStagingPayment(
            inputs.paymentOverrides as Partial<Parameters<typeof generateStagingPayment>[0]>
        );
        await (checkoutPage as FlighthubCheckoutPage).fillPaymentAndBilling(
            payment
        );

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '005-payment-filled.png'),
            fullPage: false,
        });

        emitOk({
            scenario_dir: scenarioDir,
            brand,
            env,
            checkout_url: checkoutUrl,
            content_source: inputs.contentSource ?? null,
            package_index: inputs.packageIndex ?? null,
            failure_injection: inputs.failureInjection ?? null,
            screenshots: [
                '001-search-results.png',
                '002-after-select.png',
                '003-passenger-filled.png',
                '004-payment-surface.png',
                '005-payment-filled.png',
            ],
        });
    } catch (e) {
        await session.page
            .screenshot({
                path: scenarioPath(scenarioDir, '999-error.png'),
                fullPage: false,
            })
            .catch(() => undefined);
        emitError('unhandled_exception', { detail: String(e) });
    } finally {
        await session.close();
    }
}

main();
