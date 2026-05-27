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
import { mysqlQuery } from './_lib/db';
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

    // Infer brand/env from the search URL host.
    let brand = inputs.brand;
    let env = inputs.env;
    const searchUrlHost = new URL(flags.searchUrl!).hostname;
    if (searchUrlHost.includes('justfly')) brand = 'justfly';
    else if (searchUrlHost.includes('flighthub')) brand = 'flighthub';
    if (searchUrlHost.startsWith('www.')) {
        env = 'production';
    } else {
        const stagingMatch = /^(staging\d+)\./.exec(searchUrlHost);
        env = stagingMatch ? stagingMatch[1] : 'staging2';
    }

    try {
        loadEnv(`${brand}-${env}`);
    } catch (e) {
        emitError('env_load_failed', { detail: String(e) });
    }

    const cs = inputs.contentSource;
    const officeId = inputs.officeId;
    const label = flags.label ?? `book-${cs ?? 'pkg' + (inputs.packageIndex ?? 0)}`;
    const scenarioDir = flags.scenarioDir ?? createScenarioDir(label);

    log(`brand=${brand} env=${env} mode=${inputs.mode}`);
    log(`search_url: ${flags.searchUrl}`);
    log(
        `pin: content_source=${cs ?? '(none)'} office_id=${officeId ?? '(none)'} package_index=${inputs.packageIndex ?? '(none)'}`
    );
    log(`failure_injection: ${inputs.failureInjection ?? '(none)'}`);
    log(`scenarioDir: ${scenarioDir}`);

    // Emit a stderr banner mirroring the Python runner's contract.
    process.stderr.write(
        `[qa-book banner] brand=${brand} env=${env} ` +
        `content_source=${cs ?? '(none)'} ` +
        `office_id=${officeId ?? '(none)'} ` +
        `package_index=${inputs.packageIndex ?? '(none)'} ` +
        `failure_injection=${inputs.failureInjection ?? 'none'}\n`
    );

    const session = await launchBrowser(inputs.mode === 'api' ? 'ui-headless' : inputs.mode);
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

        // Filter result packages to the requested content source via the
        // staging-only Debug Filters panel. On the new staging64 storefront the
        // panel is collapsed by default and mounts its `<select id="gds">`
        // child only after the `.debug-filters-header` toggle is clicked.
        // (On older builds the select was always present; on prod the panel
        // is absent entirely.)
        //
        // Source values in the GDS option list are TitleCase ("Dida",
        // "Amadeus", "Pkfare", "Flightroutes24", …). We match user-supplied
        // --content-source case-insensitively against the option text, then
        // pass the exact `value` attribute to selectOption so the React
        // onChange handler receives a recognized supplier slug. Selecting an
        // option re-runs the search; we wait for the results list to
        // re-populate before returning.
        if (cs) {
            // eslint-disable-next-line playwright/no-raw-locators
            const filterSelect = session.page.locator('select#gds');
            // The Debug Filters panel is React-rendered AFTER the results
            // counter ticks, so checking immediately races a missing mount.
            // First try a short attached-wait on the select itself (covers both
            // cases: panel already expanded by a prior run, OR a future build
            // that ships the select expanded by default). If still missing,
            // wait for the collapsed `.debug-filters-header` toggle to mount,
            // click it, and wait again on the select.
            let hasSelect = await filterSelect
                .waitFor({ state: 'attached', timeout: 1500 })
                .then(() => true)
                .catch(() => false);
            if (!hasSelect) {
                // eslint-disable-next-line playwright/no-raw-locators
                const debugHeader = session.page.locator('.debug-filters-header');
                const headerMounted = await debugHeader
                    .waitFor({ state: 'attached', timeout: 5000 })
                    .then(() => true)
                    .catch(() => false);
                if (headerMounted) {
                    await debugHeader.click().catch(() => undefined);
                    hasSelect = await filterSelect
                        .waitFor({ state: 'attached', timeout: 5000 })
                        .then(() => true)
                        .catch(() => false);
                }
            }
            if (hasSelect) {
                // Option values are TitleCase ("Dida", "Pkfare", "Flightroutes24");
                // user-supplied --content-source is lowercase. Match the option
                // by exact-case-insensitive text first, then by substring, and
                // pass the option's `value` attribute (not the user input) to
                // selectOption so React's onChange receives a recognized slug.
                const matchingOption = filterSelect.locator('option').filter({
                    hasText: new RegExp(`^${cs}$`, 'i'),
                });
                const fallbackOption = filterSelect.locator('option').filter({
                    hasText: new RegExp(cs, 'i'),
                });
                const optionValue =
                    (await matchingOption.count()) > 0
                        ? (await matchingOption.first().getAttribute('value')) ?? cs
                        : (await fallbackOption.count()) > 0
                            ? (await fallbackOption.first().getAttribute('value')) ?? cs
                            : cs;
                const preFilterCount = await resultsPage.resultCards
                    .count()
                    .catch(() => 0);
                log(`pre-filter result cards: ${preFilterCount}`);
                await filterSelect.selectOption(optionValue).catch(() => undefined);
                log(`debug filter → ${optionValue} (matched --content-source ${cs})`);
                // If --office-id was passed, also narrow the Office ID
                // dropdown. The select is populated after the GDS choice
                // (the option list is supplier-scoped), so wait for it.
                if (officeId) {
                    // eslint-disable-next-line playwright/no-raw-locators
                    const officeSelect = session.page.locator('select#office_id');
                    const officeMounted = await officeSelect
                        .waitFor({ state: 'attached', timeout: 5000 })
                        .then(() => true)
                        .catch(() => false);
                    if (officeMounted) {
                        await officeSelect.selectOption(officeId).catch(() => undefined);
                        log(`debug filter → office_id=${officeId}`);
                    } else {
                        log(`WARN: --office-id ${officeId} not applied — select#office_id did not mount within 5s. Post-book gds_account_id check still runs.`);
                    }
                }
                // Selecting an option re-runs the search; the storefront
                // re-renders the result list asynchronously. Wait for the
                // "Done" progress indicator to come back, then poll the count
                // until it stabilises (or we time out). Without this poll the
                // count read races the re-render and sees 0 cards even when
                // the rendered page eventually shows the pinned source.
                await session.page
                    .getByText(/^Done$/)
                    .first()
                    .waitFor({ state: 'visible', timeout: 30_000 })
                    .catch(() => undefined);
                let postFilterCount = 0;
                const pollDeadline = Date.now() + 15_000;
                while (Date.now() < pollDeadline) {
                    postFilterCount = await resultsPage.resultCards
                        .count()
                        .catch(() => 0);
                    if (postFilterCount > 0) break;
                    await session.page.waitForTimeout(500);
                }
                log(`post-filter result cards: ${postFilterCount}`);
                await session.page.screenshot({
                    path: scenarioPath(scenarioDir, '001b-post-filter.png'),
                    fullPage: false,
                }).catch(() => undefined);
                if (postFilterCount === 0) {
                    emitError('no_packages_after_filter', {
                        detail: `--content-source ${cs} narrowed the results list to 0 packages on this route/date; pick a route/date where ${cs} has front-end inventory.`,
                        checkout_url: null,
                        scenario_dir: scenarioDir,
                    });
                }
            } else {
                log(`WARN: --content-source ${cs} pin not applied — select#gds did not mount within 6.5s (Debug Filters panel may be missing on this build); selecting first package (optimizer kill-switch still applies in checkout)`);
            }
        }

        if (inputs.packageIndex !== undefined) {
            await resultsPage.resultCardSelectButton(inputs.packageIndex).click();
            await resultsPage.handlePostSelectModals();
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

        // Disable optimizer when content-source is pinned (BOTH api and ui modes).
        // The repricer can otherwise swap the candidate to a different supplier
        // mid-checkout, defeating --content-source. Must happen before the
        // booking submit in either mode.
        //
        // On the new "Review & pay" checkout (and on production) the Debugging
        // Options row is absent. Probe the select first so the caller learns
        // whether the kill-switch actually flipped or whether the booking is
        // still subject to repricer swaps.
        // UI-mode optimizer kill-switch. The Playwright click DOES fire React's
        // onChange so the visible <select> shows "Yes", but it does NOT mutate
        // the underlying native <select>.value — so on its own the click does
        // not disable the optimizer (verified empirically: dumping the POST
        // body after a successful selectOption('Yes') still shows
        // qa_debug_booking_optimizer_disabled=No, and bookings get optimizer-
        // swapped anyway).
        //
        // Keep the click here only as a UI-mode best-effort (so a human watching
        // headed runs sees the toggle flipped). The real kill-switch for API
        // mode is the POST-body override further down — that one actually
        // reaches genesis. UI-mode form submits naturally pick up whatever the
        // serialized form sends, which means a React-controlled <select> in UI
        // mode may have the same problem; the recommended path is API mode.
        if (cs) {
            const hasToggle = await checkoutPage.disableOptimizerSelect.count()
                .then((n) => n > 0)
                .catch(() => false);
            if (hasToggle) {
                await checkoutPage.setOptimizerDisabled(true).catch(() => undefined);
                log('Debug Options toggle clicked (UI display only — API mode also forces qa_debug_booking_optimizer_disabled=Yes in the POST body below)');
            } else {
                log('Debug Options toggle NOT FOUND in DOM — relying on POST-body override only');
            }
        }

        // ── API-MODE BOOKING ────────────────────────────────────────────────
        // Skip all UI form interactions. Instead:
        //   1. Click Autofill to set is_test=1 server-side.
        //   2. Wait for the checkout_id + u_p_id captured by the
        //      post-saved-form-data interceptor set up above.
        //   3. Build the full capture-booking-attempts POST body from
        //      factory data and fire it via fetch() in the page context
        //      (inheriting the session cookies already established by
        //      browser navigation).
        // This bypasses the React form state entirely so qa_debug_* fields
        // come from our code, not from autofill defaults.
        if (inputs.mode === 'api') {
            if (env !== 'production') {
                const autofillCalled = await checkoutPage.clickAutofill()
                    .then(() => true)
                    .catch(() => false);
                if (autofillCalled) log('autofill clicked (is_test=1 set)');
            }

            // Advance to the payment step if this is a two-step checkout so
            // all payment DOM inputs are present before serialization. Both
            // FlightHub and JustFly have a two-step flow; the .catch makes
            // this a no-op on builds where the button is absent.
            await checkoutPage.continueToPayment().catch(() => undefined);
            // Continue-to-Payment triggers a supplier availability check
            // (e.g. TravelFusion ProcessDetails). If we submit before that
            // call returns, the supplier rejects the submit with
            // "A newer ProcessDetails call is in progress for this routing
            // session" and the booking fails with a generic GDS error.
            // Settle here so the avail check completes before we POST.
            await session.page.waitForLoadState('networkidle', {
                timeout: 15_000,
            }).catch(() => undefined);
            await session.page.waitForTimeout(1500);

            // Serialize the autofill-populated DOM form.
            // Autofill pre-fills card data the server is configured to accept on staging —
            // the factory 4242 card triggers fraud_check_cc_problem regardless of UI/API mode.
            // Raw string eval avoids tsx/esbuild injecting __name() helpers (Node-only).
            let formBody = String(await session.page.evaluate(`(() => {
                var parts = [];
                document.querySelectorAll('input[name], select[name], textarea[name]').forEach(function(el) {
                    if (el.type !== 'submit' && el.type !== 'button' && el.name) {
                        parts.push(encodeURIComponent(el.name) + '=' + encodeURIComponent(el.value || ''));
                    }
                });
                var ctx = [['ff_option','0'],['checkout_type','flight'],['controller','checkout'],['action','billing']];
                ctx.forEach(function(pair) {
                    var k = encodeURIComponent(pair[0]);
                    if (!parts.some(function(s) { return s.split('=')[0] === k; })) {
                        parts.push(k + '=' + encodeURIComponent(pair[1]));
                    }
                });
                return parts.join('&');
            })()`));
            log('serialized ' + formBody.split('&').length + ' form fields from DOM');

            // Force optimizer/repricer kill-switch into the POST body when
            // --content-source is pinned. Playwright's selectOption fires the
            // React onChange event but does NOT update the native <select>.value,
            // so the DOM serializer above captures the original "No" and POSTs
            // it (backend optimizer runs regardless of the on-page click).
            // Override the field directly in the URL-encoded body: this bypasses
            // React entirely and is the only path that actually reaches genesis.
            // Evidence: scenario reports/.../003-api-form-body.txt on a Dida-pin run
            // showed qa_debug_booking_optimizer_disabled=No despite a successful
            // Playwright toggle flip; booking 299450712 originally Pkfare was
            // optimized to Flightroutes24 mid-checkout.
            if (cs) {
                const fieldName = 'qa_debug_booking_optimizer_disabled';
                const before = formBody;
                formBody = formBody
                    // Replace existing value if present.
                    .replace(
                        new RegExp(`(^|&)${fieldName}=[^&]*`),
                        `$1${fieldName}=Yes`
                    );
                // If the field was missing from the DOM (older/newer checkout), append.
                if (!formBody.includes(`${fieldName}=`)) {
                    formBody += `&${fieldName}=Yes`;
                }
                log(before === formBody
                    ? `${fieldName}=Yes appended to POST body (field was missing from DOM)`
                    : `${fieldName} overridden to "Yes" in POST body (DOM had "No" — Playwright flip did not sync)`);
            }

            log('submitting booking via API (autofill data)…');
            const submitResult = await session.page.evaluate(
                async ({ url, body }: { url: string; body: string }) => {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body,
                        redirect: 'follow',
                    });
                    const responseJson = await response.json().catch(() => null);
                    return { status: response.status, redirectUrl: response.url, responseJson };
                },
                {
                    url: `${checkoutUrl.replace(/[?#].*/, '')}/capture-booking-attempts`,
                    body: formBody,
                }
            );

            log(`api submit: status=${submitResult.status}`);
            const resp = submitResult.responseJson as Record<string, unknown> | null;
            const apiResult    = resp?.result;
            const apiErrorType = resp?.error_type;
            const apiBcai      = resp?.bcai;
            // capture-booking-attempts is a JSON API — React navigates client-side
            // to the URL the JSON carries; there is no HTTP redirect to follow.
            const apiPortalUrl = String(resp?.redirect ?? resp?.redirect_url ?? resp?.redirectUrl ?? resp?.portal_url ?? '');

            if (apiErrorType) log(`api error_type=${String(apiErrorType)} bcai=${String(apiBcai ?? '')}`);

            // Detect failure injection: result=false with no fraud error = injection fired.
            if (
                inputs.failureInjection &&
                apiResult === false &&
                !apiPortalUrl.includes('/portal/detail/')
            ) {
                emitError('booking_failed_by_injection', {
                    failure_origin: 'qa_injection',
                    failure_injection: inputs.failureInjection,
                    detail: 'Booking pipeline short-circuited as expected (no portal redirect).',
                    checkout_url: checkoutUrl,
                    scenario_dir: scenarioDir,
                });
            }

            // Portal URL is in the JSON body (may be relative); resolve against checkout origin.
            const checkoutOrigin = new URL(checkoutUrl).origin;
            const portalUrlRaw = apiPortalUrl.includes('/portal/detail/') ? apiPortalUrl
                : submitResult.redirectUrl.includes('/portal/detail/') ? submitResult.redirectUrl
                : '';
            const portalUrlFromJson = portalUrlRaw.startsWith('/')
                ? `${checkoutOrigin}${portalUrlRaw}`
                : portalUrlRaw;
            const hashMatch = /\/portal\/detail\/([a-f0-9]+)/.exec(portalUrlFromJson);
            idHash = hashMatch?.[1] ?? null;

            if (!idHash) {
                emitError('booking_api_no_portal_redirect', {
                    detail: `No portal redirect found. status=${submitResult.status} result=${String(apiResult)} error_type=${String(apiErrorType ?? '')}`,
                    error_type: apiErrorType ?? null,
                    bcai: apiBcai ?? null,
                    server_response: resp,
                    checkout_url: checkoutUrl,
                    scenario_dir: scenarioDir,
                });
            }

            log(`booking confirmed (api): id_hash=${idHash}`);

            // Post-book pin verify. The runner's --content-source / --office-id
            // flags drive the storefront-side filter, but the booker can still
            // pivot mid-flight (optimizer / supplier fallback). Read the
            // bookings row and surface gds + gds_account_id so the agent does
            // not have to remember to verify; do not fail here — record the
            // mismatch on the JSON so the caller decides.
            let bookedGds: string | null = null;
            let bookedGdsAccountId: string | null = null;
            let bookedId: number | null = null;
            let pinVerified: boolean | null = null;
            let pinMismatch: string | null = null;
            if (idHash) {
                try {
                    const rows = await mysqlQuery(
                        `SELECT id, gds, gds_account_id FROM ota.bookings WHERE id_hash = '${idHash.replace(/'/g, "''")}' LIMIT 1`
                    );
                    if (rows.length > 0) {
                        bookedId = (rows[0].id as number) ?? null;
                        bookedGds = (rows[0].gds as string) ?? null;
                        bookedGdsAccountId =
                            (rows[0].gds_account_id as string) ?? null;
                        const csOk = cs
                            ? bookedGds?.toLowerCase() === cs.toLowerCase()
                            : true;
                        const officeOk = officeId
                            ? bookedGdsAccountId?.toUpperCase() ===
                              officeId.toUpperCase()
                            : true;
                        pinVerified = csOk && officeOk;
                        if (!csOk) {
                            pinMismatch = `content_source: pinned=${cs} booked=${bookedGds}`;
                        } else if (!officeOk) {
                            pinMismatch = `office_id: pinned=${officeId} booked=${bookedGdsAccountId}`;
                        }
                        log(
                            `post-book pin verify: gds=${bookedGds} gds_account_id=${bookedGdsAccountId} pin_verified=${pinVerified}` +
                                (pinMismatch ? ` mismatch=${pinMismatch}` : '')
                        );
                    } else {
                        log(
                            'post-book pin verify: booking row not found yet (replication lag?). Caller should re-check via qa-validate.'
                        );
                    }
                } catch (e) {
                    log(
                        `post-book pin verify: SKIPPED (${(e as Error).message.slice(0, 120)})`
                    );
                }
            }

            emitOk({
                scenario_dir: scenarioDir,
                brand,
                env,
                checkout_url: checkoutUrl,
                portal_url: portalUrlFromJson,
                id_hash: idHash,
                booking_id: bookedId,
                content_source_booked: cs ?? null,
                office_id_pinned: officeId ?? null,
                gds: bookedGds,
                gds_account_id: bookedGdsAccountId,
                pin_verified: pinVerified,
                pin_mismatch: pinMismatch,
                package_index_booked: inputs.packageIndex ?? null,
                failure_injection: inputs.failureInjection ?? null,
                screenshots: ['001-search-results.png', '002-checkout.png'],
            });
            return;
        }
        // ── END API-MODE BOOKING ─────────────────────────────────────────────

        // On staging: click Autofill to set is_test=1 server-side before form fill.
        // On the new "Review & pay" checkout Debugging Options are absent, so Autofill
        // is the only remaining test hook. No-ops if the link is not present (production
        // or old checkout). Called before passenger fill so our factory data overwrites
        // the autofill pre-fill on every field.
        if (env !== 'production') {
            const autofillCalled = await (checkoutPage as FlighthubCheckoutPage)
                .clickAutofill()
                .then(() => true)
                .catch(() => false);
            if (autofillCalled) log('autofill clicked (is_test=1 set)');
        }

        // Pin ConnexPay before continueToPayment() — the Debugging Options
        // section is hidden once the payment panel expands.
        if (brand === 'flighthub' && env !== 'production') {
            await (checkoutPage as FlighthubCheckoutPage)
                .useConnexPayMerchant()
                .catch(() => undefined);
        }

        // Set failure injection before passenger form (mirrors Python runner order).
        // JustflyCheckoutPage exposes bookingFailureReasonSelect with the same
        // selector logic; no brand guard needed.
        if (inputs.failureInjection) {
            const anyCheckout = checkoutPage as FlighthubCheckoutPage;
            const failureOption = anyCheckout.bookingFailureReasonSelect
                .locator('option')
                .filter({ hasText: new RegExp(inputs.failureInjection, 'i') });
            const failureValue = (await failureOption.count()) > 0
                ? (await failureOption.first().getAttribute('value') ?? inputs.failureInjection)
                : inputs.failureInjection;
            await anyCheckout.bookingFailureReasonSelect
                .selectOption(failureValue)
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
            (errMsg.includes('waitForURL') || errMsg.includes('Timeout'))
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
