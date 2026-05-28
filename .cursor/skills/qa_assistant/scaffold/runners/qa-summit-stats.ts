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
 *
 *   # Also download every supplier's raw NDC/SOAP request and response
 *   # (api_url has `get_gds_exchange=1` baked in by Summit; replaying it
 *   # returns gds_request / gds_response URLs that we then download via
 *   # the authed Summit session):
 *   npm run qa-summit-stats -- --search-hash <hash> --fetch-exchange
 *
 *   # Limit the harvest to one supplier:
 *   npm run qa-summit-stats -- --search-hash <hash> --fetch-exchange --exchange-sources aircanadandc
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnv } from './_lib/envLoader';
import { emitOk, emitError, log } from './_lib/stdout';
import { createScenarioDir, scenarioPath } from './_lib/scenarioDir';
import { launchBrowser } from './_lib/browser';
import { SummitStatsPage } from '../pages/shared/summitStats.page';
import type { Mode } from '../fixtures/helper/bookingInputs';
import type { BrowserContext } from '@playwright/test';
import type { UrlStatRecord } from '../pages/shared/summitStats.page';

interface RunnerFlags {
    searchHash?: string;
    scenarioDir?: string;
    label?: string;
    mode?: Mode;
    env?: string;
    /**
     * When set, after parsing the Summit `#urlStats` table the runner
     * replays each printed `api_url` (which already carries
     * `get_gds_exchange=1`), reads `gds_request` / `gds_response` URLs
     * from the JSON body, and downloads both payloads via the authed
     * Summit session. Files land in `<scenario_dir>/exchanges/`. Opt-in
     * because replaying every outbound URL costs real time (~10–30 s
     * for a 30-call search) and re-issues the supplier query.
     */
    fetchExchange?: boolean;
    /**
     * Skip any url_stats record whose `content_source` is not in this
     * comma-separated allowlist. Defaults to all sources. Useful when
     * you only need one supplier's exchange (e.g. `--exchange-sources aircanadandc`).
     */
    exchangeSources?: string[];
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
        // Boolean toggle — accept `--fetch-exchange` and
        // `--fetch-exchange=true|false`.
        if (tok === '--fetch-exchange') {
            flags.fetchExchange = true;
            continue;
        }
        if (tok.startsWith('--fetch-exchange=')) {
            const value = tok.slice('--fetch-exchange='.length).toLowerCase();
            flags.fetchExchange = value !== 'false' && value !== '0';
            continue;
        }
        const sources = pick('exchange-sources');
        if (sources !== undefined) {
            flags.exchangeSources = sources
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter((s) => s.length > 0);
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

interface ExchangeOutcome {
    url_id: number;
    content_source: string | null;
    /** `ok` (both downloaded), `replay_failed`, `no_exchange`, `download_failed`. */
    status: 'ok' | 'replay_failed' | 'no_exchange' | 'download_failed';
    gds_request_url?: string;
    gds_response_url?: string;
    rq_file?: string;
    rs_file?: string;
    rq_bytes?: number;
    rs_bytes?: number;
    error?: string;
}

interface FareFetchReplayBody {
    gds_request?: string;
    gds_response?: string;
    gds_exchange_ttl?: number;
}

/**
 * For each url_stats record, replays the printed `api_url` (already
 * carries `get_gds_exchange=1`), then downloads the `gds_request` and
 * `gds_response` payloads via the authed Summit session.
 *
 * Sequential (~ 30 records × 3 HTTP calls = ~90 requests for a typical
 * search; serial keeps the load predictable and the failure modes
 * easier to reason about). The api_url replay re-issues the supplier
 * call — this is opt-in for that reason.
 *
 * Output filenames follow `<url_id>-<content_source>.{rq,rs}.<ext>` so
 * a directory listing is self-describing. Extension is derived from
 * the `content-type` header (xml / json / fallback txt).
 */
async function harvestExchanges(
    context: BrowserContext,
    records: UrlStatRecord[],
    outDir: string,
    sourceAllowlist?: string[]
): Promise<ExchangeOutcome[]> {
    fs.mkdirSync(outDir, { recursive: true });
    const outcomes: ExchangeOutcome[] = [];

    const pickExt = (contentType: string): string => {
        const ct = contentType.toLowerCase();
        if (ct.includes('xml')) return '.xml';
        if (ct.includes('json')) return '.json';
        return '.txt';
    };

    for (const rec of records) {
        const source = rec.content_source ?? 'unknown';
        if (
            sourceAllowlist &&
            sourceAllowlist.length > 0 &&
            !sourceAllowlist.includes(source.toLowerCase())
        ) {
            continue;
        }

        const base: ExchangeOutcome = {
            url_id: rec.url_id,
            content_source: rec.content_source,
            status: 'no_exchange',
        };

        if (!rec.api_url) {
            outcomes.push({
                ...base,
                status: 'no_exchange',
                error: 'api_url missing on this row',
            });
            continue;
        }

        let body: FareFetchReplayBody;
        try {
            const resp = await context.request.get(rec.api_url);
            if (!resp.ok()) {
                outcomes.push({
                    ...base,
                    status: 'replay_failed',
                    error: `HTTP ${resp.status()} from api_url replay`,
                });
                continue;
            }
            // Some fare-fetch backends wrap the body in non-JSON
            // frames when nothing fetched (e.g. `no_stats: true` rows).
            // Treat parse failures as `no_exchange` rather than fatal.
            const text = await resp.text();
            try {
                body = JSON.parse(text) as FareFetchReplayBody;
            } catch (parseErr) {
                outcomes.push({
                    ...base,
                    status: 'no_exchange',
                    error: `replay body not JSON: ${String(parseErr)}`,
                });
                continue;
            }
        } catch (e) {
            outcomes.push({
                ...base,
                status: 'replay_failed',
                error: String(e),
            });
            continue;
        }

        if (!body.gds_request || !body.gds_response) {
            outcomes.push({
                ...base,
                status: 'no_exchange',
                gds_request_url: body.gds_request,
                gds_response_url: body.gds_response,
                error: 'replay body did not include both gds_request and gds_response (likely a cache hit or `no stats=true` row)',
            });
            continue;
        }

        try {
            const [rqResp, rsResp] = await Promise.all([
                context.request.get(body.gds_request),
                context.request.get(body.gds_response),
            ]);
            if (!rqResp.ok() || !rsResp.ok()) {
                outcomes.push({
                    ...base,
                    status: 'download_failed',
                    gds_request_url: body.gds_request,
                    gds_response_url: body.gds_response,
                    error: `HTTP rq=${rqResp.status()} rs=${rsResp.status()}`,
                });
                continue;
            }
            const rqBytes = await rqResp.body();
            const rsBytes = await rsResp.body();
            const stem = `${String(rec.url_id).padStart(3, '0')}-${source}`;
            const rqFile = path.join(
                outDir,
                `${stem}.rq${pickExt(rqResp.headers()['content-type'] ?? '')}`
            );
            const rsFile = path.join(
                outDir,
                `${stem}.rs${pickExt(rsResp.headers()['content-type'] ?? '')}`
            );
            fs.writeFileSync(rqFile, rqBytes);
            fs.writeFileSync(rsFile, rsBytes);
            outcomes.push({
                ...base,
                status: 'ok',
                gds_request_url: body.gds_request,
                gds_response_url: body.gds_response,
                rq_file: rqFile,
                rs_file: rsFile,
                rq_bytes: rqBytes.length,
                rs_bytes: rsBytes.length,
            });
        } catch (e) {
            outcomes.push({
                ...base,
                status: 'download_failed',
                gds_request_url: body.gds_request,
                gds_response_url: body.gds_response,
                error: String(e),
            });
        }
    }

    return outcomes;
}

function renderExchangesIndex(outcomes: ExchangeOutcome[]): string {
    const header =
        '| url_id | content_source | status | rq_bytes | rs_bytes | rq_file | rs_file | error |';
    const sep =
        '|--------|----------------|--------|----------|----------|---------|---------|-------|';
    const body = outcomes
        .map(
            (o) =>
                `| ${o.url_id} | ${o.content_source ?? ''} | ${o.status} | ${o.rq_bytes ?? ''} | ${o.rs_bytes ?? ''} | ${o.rq_file ? path.basename(o.rq_file) : ''} | ${o.rs_file ? path.basename(o.rs_file) : ''} | ${o.error ?? ''} |`
        )
        .join('\n');
    return `${header}\n${sep}\n${body}\n`;
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

        let exchanges: ExchangeOutcome[] | undefined;
        if (flags.fetchExchange) {
            const filter = flags.exchangeSources;
            log(
                `harvesting raw supplier exchanges${
                    filter && filter.length > 0
                        ? ` for sources: ${filter.join(', ')}`
                        : ''
                } — this replays every outbound api_url`
            );
            exchanges = await harvestExchanges(
                session.context,
                urlStats,
                path.resolve(scenarioDir, 'exchanges'),
                filter
            );
            fs.writeFileSync(
                path.resolve(scenarioDir, 'exchanges', 'README.md'),
                renderExchangesIndex(exchanges)
            );
            const ok = exchanges.filter((o) => o.status === 'ok').length;
            const skipped = exchanges.length - ok;
            log(
                `harvested ${ok}/${exchanges.length} exchanges (${skipped} skipped or failed — see exchanges/README.md)`
            );
        }

        const payload = {
            scenario_dir: scenarioDir,
            search_hash: flags.searchHash,
            summit_url: `${process.env.SUMMIT_URL ?? 'https://staging2-summit.flighthub.com'}/flight-search/info/${flags.searchHash}`,
            summary,
            extra_stats: extraStats,
            url_stats_count: urlStats.length,
            url_stats: urlStats,
            ...(exchanges ? { exchanges } : {}),
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
