#!/usr/bin/env node
/**
 * qa-book — Full booking runner (Card 4: UI mode).
 *
 * Re-opens a `search_url` (from `qa-search` output), picks a package by
 * content-source slug or 0-based index, drives the passenger / payment
 * form, and presses "Confirm and Book". Returns the booking_id extracted
 * from the post-confirmation portal URL once the page settles.
 *
 * Content-source pinning:
 *   When `--content-source` is passed the runner disables the
 *   Optimizer/Repricer on the checkout page before submit (mirrors the
 *   Python runner — without this the repricer can swap the candidate to a
 *   different supplier at book time). `--package-index` leaves the
 *   optimizer enabled (the index-based path exercises the production path
 *   with optimizer active). The two flags are mutually exclusive per
 *   BookingInputsSchema.
 *
 * Failure injection:
 *   Pass `--failure-injection "CC Decline"` to exercise an explicit
 *   failure path. The runner sets the Debugging Options dropdown before
 *   submit and emits `booking_failed_by_injection` (which is the expected
 *   outcome, not an error). No supplier is contacted and no
 *   `ota.bookings` row is written.
 *
 * Stdout: single JSON object.
 * Stderr: progress logs.
 *
 * Usage:
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npx tsx runners/qa-book.ts \
 *     --mode ui-headless \
 *     --search-url "https://staging2.flighthub.com/flight/search?..." \
 *     --content-source amadeus \
 *     --origin YUL --dest LAX --depart 2026-08-01
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
    generatePassengersFromBookingInputs,
    generatePassportsFromBookingInputs,
} from '../test-data/factories/flighthub/search.factory';
import { generateStagingPayment } from '../test-data/factories/flighthub/payment.factory';
import { generateAdultPassenger } from '../test-data/factories/flighthub/passenger.factory';
import { generatePassport } from '../test-data/factories/flighthub/passport.factory';
import { FlighthubSearchResultsPage } from '../pages/flighthub/searchResults.page';
import { JustflySearchResultsPage } from '../pages/justfly/searchResults.page';
import { FlighthubCheckoutPage } from '../pages/flighthub/checkout.page';
import { JustflyCheckoutPage } from '../pages/justfly/checkout.page';
import { FlighthubBookingConfirmationPage } from '../pages/flighthub/bookingConfirmation.page';
import { JustflyBookingConfirmationPage } from '../pages/justfly/bookingConfirmation.page';

interface RunnerFlags {
    searchUrl?: string;
    scenarioDir?: string;
    label?: string;
}

function extractRunnerFlags(argv: string[]): {
    flags: RunnerFlags;
    remaining: string[];
} {
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
            detail:
                '--search-url is required (from qa-search output.search_url).',
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
                'qa-book drives the checkout and confirmation forms, which require a browser. Pass --mode ui-headless or --mode ui-headed.',
        });
    }

    // Infer brand/env from the search URL host.
    let brand = inputs.brand;
    let env = inputs.env;
    const searchUrlHost = new URL(flags.searchUrl!).hostname;
    if (searchUrlHost.includes('justfly')) brand = 'justfly';
    else if (searchUrlHost.includes('flighthub')) brand = 'flighthub';
    if (searchUrlHost.startsWith('www.')) env = 'production';
    else env = 'staging2';

    try {
        loadEnv(`${brand}-${env}`);
    } catch (e) {
        emitError('env_load_failed', { detail: String(e) });
    }

    const cs = inputs.contentSource;
    const label = flags.label ?? `book-${cs ?? 'pkg' + (inputs.packageIndex ?? 0)}`;
    const scenarioDir = flags.scenarioDir ?? createScenarioDir(label);

    log(`brand=${brand} env=${env} mode=${inputs.mode}`);
    log(`search_url: ${flags.searchUrl}`);
    log(
        `pin: content_source=${cs ?? '(none)'} package_index=${inputs.packageIndex ?? '(none)'}`
    );
    log(`failure_injection: ${inputs.failureInjection ?? '(none)'}`);
    log(`scenarioDir: ${scenarioDir}`);

    // Emit a stderr banner mirroring the Python runner's contract.
    process.stderr.write(
        `[qa-book banner] brand=${brand} env=${env} ` +
        `content_source=${cs ?? '(none)'} ` +
        `package_index=${inputs.packageIndex ?? '(none)'} ` +
        `failure_injection=${inputs.failureInjection ?? 'none'}\n`
    );

    const session = await launchBrowser(inputs.mode);
    let checkoutUrl = '';
    let idHash: string | null = null;

    try {
        await session.page.goto(flags.searchUrl!);

        const resultsPage =
            brand === 'flighthub'
                ? new FlighthubSearchResultsPage(session.page)
                : new JustflySearchResultsPage(session.page);

        await resultsPage.waitForResults();
        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '001-search-results.png'),
            fullPage: false,
        });

        // On staging2, filter to content source before selecting.
        if (cs && brand === 'flighthub') {
            // eslint-disable-next-line playwright/no-raw-locators
            const filterSelect = session.page.locator('select#gds');
            if ((await filterSelect.count()) > 0) {
                await filterSelect.selectOption({ label: new RegExp(cs, 'i') }).catch(async () => {
                    await filterSelect.selectOption(cs).catch(() => undefined);
                });
                log(`debug filter → ${cs}`);
                await resultsPage.waitForResults();
            }
        }

        if (inputs.packageIndex !== undefined) {
            await resultsPage.resultCardSelectButton(inputs.packageIndex).click();
            // Handle post-Select modals (bundle / fare-upgrade / fare-family).
            await resultsPage.selectFirstResult().catch(() => undefined);
        } else {
            await resultsPage.selectFirstResult();
        }

        await session.page.waitForURL(/\/checkout\/billing\/flight\//, {
            timeout: 30000,
        });
        checkoutUrl = session.page.url();
        log(`checkout URL: ${checkoutUrl}`);

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '002-checkout.png'),
            fullPage: false,
        });

        const checkoutPage =
            brand === 'flighthub'
                ? new FlighthubCheckoutPage(session.page)
                : new JustflyCheckoutPage(session.page);

        // Disable optimizer when content-source is pinned.
        if (cs && brand === 'flighthub') {
            await (checkoutPage as FlighthubCheckoutPage)
                .setOptimizerDisabled(true)
                .catch(() => undefined);
            log('optimizer disabled');
        }

        // Set failure injection before passenger form (mirrors Python runner order).
        if (inputs.failureInjection && brand === 'flighthub') {
            const fhCheckout = checkoutPage as FlighthubCheckoutPage;
            await fhCheckout.bookingFailureReasonSelect
                .selectOption({
                    label: new RegExp(inputs.failureInjection, 'i'),
                })
                .catch(() => undefined);
            log(`failure injection → ${inputs.failureInjection}`);
        }

        // Build + fill passengers.
        const passengers = inputs.route
            ? generatePassengersFromBookingInputs({ ...inputs, brand, env })
            : [generateAdultPassenger()];

        for (let idx = 0; idx < passengers.length; idx++) {
            await (checkoutPage as FlighthubCheckoutPage).fillPassenger(
                idx + 1,
                passengers[idx]
            );
        }

        // Fill passports if present.
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

        // Use ConnexPay on staging to avoid repeat-BIN fraud block.
        if (brand === 'flighthub' && env !== 'production') {
            await (checkoutPage as FlighthubCheckoutPage)
                .useConnexPayMerchant()
                .catch(() => undefined);
        }

        // Fill payment.
        const payment = generateStagingPayment(
            inputs.paymentOverrides as Partial<
                Parameters<typeof generateStagingPayment>[0]
            >
        );
        await (checkoutPage as FlighthubCheckoutPage).fillPaymentAndBilling(payment);

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '004-payment-filled.png'),
            fullPage: false,
        });

        // Submit.
        log('submitting booking…');
        await (checkoutPage as FlighthubCheckoutPage).submitBookingAndAwaitConfirmation();

        // If we get here without an injection, the booking confirmed.
        const confirmationPage =
            brand === 'flighthub'
                ? new FlighthubBookingConfirmationPage(session.page)
                : new JustflyBookingConfirmationPage(session.page);

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '005-confirmation.png'),
            fullPage: false,
        });

        // Extract booking_id from the page heading.
        let bookingId: string | null = null;
        if (brand === 'flighthub') {
            const fhConfirm = confirmationPage as FlighthubBookingConfirmationPage;
            bookingId = await fhConfirm.extractBookingId().catch(() => null);
        }

        // id_hash is in the portal URL: /service/portal/detail/<id_hash>
        const portalUrl = session.page.url();
        const hashMatch = /\/portal\/detail\/([a-f0-9]+)/.exec(portalUrl);
        idHash = hashMatch ? hashMatch[1] : null;

        log(`booking confirmed: booking_id=${bookingId} id_hash=${idHash}`);

        emitOk({
            scenario_dir: scenarioDir,
            brand,
            env,
            checkout_url: checkoutUrl,
            portal_url: portalUrl,
            id_hash: idHash,
            booking_id: bookingId,
            content_source_booked: cs ?? null,
            package_index_booked: inputs.packageIndex ?? null,
            failure_injection: inputs.failureInjection ?? null,
            screenshots: [
                '001-search-results.png',
                '002-checkout.png',
                '003-passenger-filled.png',
                '004-payment-filled.png',
                '005-confirmation.png',
            ],
        });
    } catch (e) {
        const errMsg = String(e);
        await session.page
            .screenshot({
                path: scenarioPath(scenarioDir, '999-error.png'),
                fullPage: false,
            })
            .catch(() => undefined);

        // Detect injection-triggered failure (storefront re-renders payment
        // page with an alert instead of navigating to the portal URL).
        if (
            inputs.failureInjection &&
            errMsg.includes('waitForURL') ||
            errMsg.includes('Timeout')
        ) {
            const pageText = await session.page.textContent('body').catch(() => '');
            const hasAlert =
                pageText?.includes('Credit Card') ||
                pageText?.includes('declined') ||
                pageText?.includes('fraud') ||
                pageText?.includes('Fare Increase') ||
                pageText?.includes('not available');

            if (hasAlert) {
                emitError('booking_failed_by_injection', {
                    failure_origin: 'qa_injection',
                    failure_injection: inputs.failureInjection,
                    detail:
                        'Booking pipeline short-circuited as expected for the requested failure path.',
                    checkout_url: checkoutUrl,
                    scenario_dir: scenarioDir,
                });
            }
        }

        emitError('unhandled_exception', {
            detail: errMsg,
            checkout_url: checkoutUrl || null,
            scenario_dir: scenarioDir,
        });
    } finally {
        await session.close();
    }
}

main();
