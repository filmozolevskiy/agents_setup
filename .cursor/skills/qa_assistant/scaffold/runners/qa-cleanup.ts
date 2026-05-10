#!/usr/bin/env node
/**
 * qa-cleanup — Cancel a test booking via ResPro (Card 4).
 *
 * Drives the ResPro UI: login → open booking detail → Abort Booking dialog
 * → submit. Idempotent: if the booking is already aborted the runner
 * returns `was_already_aborted=true` without re-submitting.
 *
 * ResPro is shared across staging and production; the URL never changes
 * regardless of `--env`.
 *
 * Stdout: single JSON object.
 * Stderr: progress logs.
 *
 * Usage:
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npx tsx runners/qa-cleanup.ts \
 *     --booking-id 297983572 \
 *     --mode ui-headless \
 *     --scenario-dir reports/20260801-120000-amadeus-smoke
 */

import { loadEnv } from './_lib/envLoader';
import { emitOk, emitError, log } from './_lib/stdout';
import { createScenarioDir, scenarioPath } from './_lib/scenarioDir';
import { launchBrowser } from './_lib/browser';
import { ResproPage } from '../pages/shared/respro.page';
import { AbortReason } from '../enums/shared/respro';
import type { Mode } from '../fixtures/helper/bookingInputs';

interface RunnerFlags {
    bookingId?: string;
    scenarioDir?: string;
    label?: string;
    mode?: Mode;
    env?: string;
}

function parseFlags(argv: string[]): RunnerFlags {
    const flags: RunnerFlags = {};

    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        const pick = (name: string): string | undefined => {
            if (tok === `--${name}`) return argv[++i];
            if (tok.startsWith(`--${name}=`))
                return tok.slice(`--${name}=`.length);
            return undefined;
        };

        const bookingId = pick('booking-id');
        if (bookingId !== undefined) { flags.bookingId = bookingId; continue; }
        const scenarioDir = pick('scenario-dir');
        if (scenarioDir !== undefined) { flags.scenarioDir = scenarioDir; continue; }
        const label = pick('label');
        if (label !== undefined) { flags.label = label; continue; }
        const mode = pick('mode');
        if (mode !== undefined) { flags.mode = mode as Mode; continue; }
        const env = pick('env');
        if (env !== undefined) { flags.env = env; continue; }
    }

    return flags;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));

    if (!flags.bookingId) {
        emitError('missing_booking_id', {
            detail: '--booking-id is required.',
        });
    }

    const mode: Mode = flags.mode ?? 'ui-headless';
    if (mode === 'api') {
        emitError('api_mode_not_supported', {
            detail:
                'qa-cleanup always uses the ResPro UI; pass --mode ui-headless or --mode ui-headed.',
        });
    }

    // Load env to resolve RESPRO_URL / RESPRO_USER / RESPRO_PASS.
    const target = flags.env
        ? `flighthub-${flags.env}`
        : process.env.TARGET ?? 'flighthub-staging2';
    try {
        loadEnv(target);
    } catch (e) {
        emitError('env_load_failed', { detail: String(e) });
    }

    if (!process.env.RESPRO_URL) {
        emitError('missing_respro_config', {
            detail:
                'RESPRO_URL is not set. Populate env/.env per env/.env.example.',
        });
    }

    const label = flags.label ?? `cleanup-${flags.bookingId}`;
    const scenarioDir = flags.scenarioDir ?? createScenarioDir(label);

    log(`booking_id: ${flags.bookingId}`);
    log(`mode: ${mode}`);
    log(`scenarioDir: ${scenarioDir}`);

    const session = await launchBrowser(mode);

    try {
        const respro = new ResproPage(session.page);
        await respro.login();
        log('logged into ResPro');

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '001-respro-logged-in.png'),
            fullPage: false,
        });

        await respro.openBooking(flags.bookingId!);
        log(`opened booking: ${flags.bookingId}`);

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '002-booking-detail.png'),
            fullPage: false,
        });

        // Check if already aborted (idempotent path).
        const bodyText = await session.page.textContent('body').catch(() => '');
        if (bodyText?.includes('Aborted by')) {
            log('booking already aborted — returning idempotent result');
            await session.page.screenshot({
                path: scenarioPath(scenarioDir, '003-already-aborted.png'),
                fullPage: false,
            });
            emitOk({
                scenario_dir: scenarioDir,
                booking_id: flags.bookingId,
                aborted: true,
                was_already_aborted: true,
                screenshots: [
                    '001-respro-logged-in.png',
                    '002-booking-detail.png',
                    '003-already-aborted.png',
                ],
            });
        }

        await respro.abortAndConfirm(AbortReason.TEST);
        log('abort submitted');

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, '003-aborted.png'),
            fullPage: false,
        });

        emitOk({
            scenario_dir: scenarioDir,
            booking_id: flags.bookingId,
            aborted: true,
            was_already_aborted: false,
            screenshots: [
                '001-respro-logged-in.png',
                '002-booking-detail.png',
                '003-aborted.png',
            ],
        });
    } catch (e) {
        await session.page
            .screenshot({
                path: scenarioPath(scenarioDir, '999-error.png'),
                fullPage: false,
            })
            .catch(() => undefined);
        emitError('unhandled_exception', {
            detail: String(e),
            booking_id: flags.bookingId,
            scenario_dir: scenarioDir,
        });
    } finally {
        await session.close();
    }
}

main();
