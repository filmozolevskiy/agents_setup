#!/usr/bin/env node
/**
 * qa-summit-stats — dump per-content-source outbound calls from the
 * staging Summit per-search stats page for a given `search_hash`.
 *
 * Stateless: logs into Summit, navigates to `/flight-search/info/<hash>`,
 * parses three surfaces (search-level Stats summary, Extra Stats rollups,
 * and the transposed `#urlStats` table flipped to one record per
 * outbound supplier call), and emits a single JSON object on stdout.
 *
 * Persisted artefacts (also written to the scenario dir for evidence
 * dumps the agent can cite as Proof on a Trello card / Notion plan):
 *
 *   - `summit-stats.json`   — the same payload as stdout, pretty-printed
 *   - `summit-stats.md`     — short markdown table (url_id, content_source,
 *                             office_id, runtime, received, priced, total,
 *                             api_url) for human-readable inclusion
 *   - `summit-stats.png`    — full-page screenshot of the Summit view
 *
 * 20-min staleness caveat: Summit retains the stats record for ~20 min
 * after the search runs. Older hashes return "Error: Search not found"
 * and the runner exits with `error=summit_search_not_found`. Drive a
 * fresh search via `qa-search` (or pull a `search_id` from
 * `search_api_stats.gds_raw` from the last ~5 min) and retry.
 *
 * Production Summit (`https://summit.flighthub.com`) is **not** covered
 * — staging only, per `page_inventory.md § 6`.
 *
 * Stdout: single JSON object.
 * Stderr: progress logs.
 *
 * Usage:
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npm run qa-summit-stats -- --search-hash <hash> [--mode ui-headless|ui-headed] [--scenario-dir reports/<UTC>-<label>]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnv } from './_lib/envLoader';
import { emitOk, emitError, log } from './_lib/stdout';
import { createScenarioDir, scenarioPath } from './_lib/scenarioDir';
import { launchBrowser } from './_lib/browser';
import { SummitStatsPage } from '../pages/shared/summitStats.page';
import type { Mode } from '../fixtures/helper/bookingInputs';

interface RunnerFlags {
    searchHash?: string;
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

        const searchHash = pick('search-hash');
        if (searchHash !== undefined) {
            flags.searchHash = searchHash;
            continue;
        }
        const scenarioDir = pick('scenario-dir');
        if (scenarioDir !== undefined) {
            flags.scenarioDir = scenarioDir;
            continue;
        }
        const label = pick('label');
        if (label !== undefined) {
            flags.label = label;
            continue;
        }
        const mode = pick('mode');
        if (mode !== undefined) {
            flags.mode = mode as Mode;
            continue;
        }
        const env = pick('env');
        if (env !== undefined) {
            flags.env = env;
            continue;
        }
    }
    return flags;
}

interface UrlStatRow {
    url_id: number;
    content_source: string | null;
    office_id: string | null;
    runtime: string | null;
    received_packages: string | null;
    priced_packages: string | null;
    total_packages: string | null;
    api_url: string | null;
}

function renderMarkdownTable(rows: UrlStatRow[]): string {
    const header =
        '| url_id | content_source | office_id | runtime | received | priced | total | api_url |';
    const sep =
        '|--------|----------------|-----------|---------|----------|--------|-------|---------|';
    const body = rows
        .map(
            (r) =>
                `| ${r.url_id} | ${r.content_source ?? ''} | ${r.office_id ?? ''} | ${r.runtime ?? ''} | ${r.received_packages ?? ''} | ${r.priced_packages ?? ''} | ${r.total_packages ?? ''} | ${r.api_url ?? ''} |`
        )
        .join('\n');
    return `${header}\n${sep}\n${body}\n`;
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));

    if (!flags.searchHash) {
        emitError('missing_search_hash', {
            detail: '--search-hash is required.',
        });
    }

    const mode: Mode = flags.mode ?? 'ui-headless';
    if (mode === 'api') {
        emitError('api_mode_not_supported', {
            detail: 'qa-summit-stats drives the Summit UI; pass --mode ui-headless or --mode ui-headed.',
        });
    }

    // Summit is hosted on the staging2 host regardless of which storefront
    // env we were testing against. We still call loadEnv to honour the
    // global env loading invariant and to bring SUMMIT_USER / SUMMIT_PASS
    // into scope from the repo-root .env file.
    const target = flags.env
        ? `flighthub-${flags.env}`
        : (process.env.TARGET ?? 'flighthub-staging2');
    try {
        loadEnv(target);
    } catch (e) {
        emitError('env_load_failed', { detail: String(e) });
    }

    if (!process.env.SUMMIT_USER || !process.env.SUMMIT_PASS) {
        emitError('missing_summit_config', {
            detail: 'SUMMIT_USER / SUMMIT_PASS are not set. Populate .env at the repo root (copy .env.example).',
        });
    }

    const label =
        flags.label ?? `summit-stats-${flags.searchHash!.slice(0, 8)}`;
    const scenarioDir = flags.scenarioDir ?? createScenarioDir(label);

    log(`search_hash: ${flags.searchHash}`);
    log(`mode: ${mode}`);
    log(`scenarioDir: ${scenarioDir}`);

    const session = await launchBrowser(mode);

    try {
        const summit = new SummitStatsPage(session.page);
        await summit.login();
        log('logged into Summit');

        await summit.openSearch(flags.searchHash!);
        log('opened search info page');

        await session.page.screenshot({
            path: scenarioPath(scenarioDir, 'summit-stats.png'),
            fullPage: true,
        });

        const summary = await summit.parseSummary();
        log(
            `parsed summary — ${Object.keys(summary.fields).length} fields, ${Object.keys(summary.links).length} links`
        );

        const extraStats = await summit.parseExtraStats();
        log(`parsed extra stats — ${Object.keys(extraStats).length} fields`);

        const urlStats = await summit.parseUrlStats();
        log(`parsed url stats — ${urlStats.length} outbound calls`);

        const compactRows: UrlStatRow[] = urlStats.map((r) => ({
            url_id: r.url_id,
            content_source: r.content_source,
            office_id: r.office_id,
            runtime: r.runtime,
            received_packages: r.received_packages,
            priced_packages: r.priced_packages,
            total_packages: r.total_packages,
            api_url: r.api_url,
        }));

        const payload = {
            scenario_dir: scenarioDir,
            search_hash: flags.searchHash,
            summit_url: `${process.env.SUMMIT_URL ?? 'https://staging2-summit.flighthub.com'}/flight-search/info/${flags.searchHash}`,
            summary,
            extra_stats: extraStats,
            url_stats_count: urlStats.length,
            url_stats: urlStats,
        };

        fs.writeFileSync(
            path.resolve(scenarioDir, 'summit-stats.json'),
            JSON.stringify(payload, null, 2) + '\n'
        );
        fs.writeFileSync(
            path.resolve(scenarioDir, 'summit-stats.md'),
            renderMarkdownTable(compactRows)
        );
        log('wrote summit-stats.json + summit-stats.md to scenario dir');

        emitOk(payload);
    } catch (e) {
        await session.page
            .screenshot({
                path: scenarioPath(scenarioDir, '999-error.png'),
                fullPage: true,
            })
            .catch(() => undefined);
        const code = (e as { code?: string }).code;
        if (code === 'SUMMIT_SEARCH_NOT_FOUND') {
            emitError('summit_search_not_found', {
                detail: String(e),
                search_hash: flags.searchHash,
                scenario_dir: scenarioDir,
            });
        }
        emitError('unhandled_exception', {
            detail: String(e),
            search_hash: flags.searchHash,
            scenario_dir: scenarioDir,
        });
    } finally {
        await session.close();
    }
}

void main();
