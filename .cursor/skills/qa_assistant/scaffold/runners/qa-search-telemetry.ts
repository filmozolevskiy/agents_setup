#!/usr/bin/env node
/**
 * qa-search-telemetry — ClickHouse search telemetry lookup.
 *
 * Queries search_api_stats.gds_raw for the given search_id (aka
 * transaction_id / search_hash) and returns which content sources
 * responded, their call counts, error rates, and package counts.
 *
 * Stdout: single JSON object.
 * Stderr: progress logs.
 *
 * Usage:
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npx tsx runners/qa-search-telemetry.ts \
 *     --transaction-id abc123def456 \
 *     --window-hours 24
 */

import dotenv from 'dotenv';
import path from 'path';
import { emitOk, emitError, log } from './_lib/stdout';
import { clickhouseQuery } from './_lib/db';

dotenv.config({ path: path.resolve(process.cwd(), '../../../../.env') });

const TABLE = 'search_api_stats.gds_raw';

interface RawRow {
    content_source: string;
    response: string;
    search_type?: string;
    num_packages_returned?: number | string;
    num_packages_blocked?: number | string;
    num_packages_won?: number | string;
    response_time_ms?: number | string;
    date_added?: string;
    [key: string]: unknown;
}

interface SourceSummary {
    content_source: string;
    status: 'ok' | 'error' | 'mixed';
    attempt_count: number;
    success_count: number;
    error_count: number;
    last_error_response: string | null;
    packages_returned: number;
    packages_blocked: number;
    packages_won: number;
    avg_response_time_ms: number | null;
    first_seen: string | null;
    last_seen: string | null;
}

function parseFlags(argv: string[]): {
    transactionId?: string;
    windowHours: number;
    sql?: string;
} {
    const flags: { transactionId?: string; windowHours: number; sql?: string } =
        { windowHours: 24 };

    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        const pick = (name: string): string | undefined => {
            if (tok === `--${name}`) return argv[++i];
            if (tok.startsWith(`--${name}=`))
                return tok.slice(`--${name}=`.length);
            return undefined;
        };

        const txId = pick('transaction-id') ?? pick('search-hash');
        if (txId !== undefined) { flags.transactionId = txId; continue; }
        const wh = pick('window-hours');
        if (wh !== undefined) { flags.windowHours = parseInt(wh, 10); continue; }
        const sql = pick('sql');
        if (sql !== undefined) { flags.sql = sql; continue; }
    }

    return flags;
}

function summariseSources(rows: RawRow[]): SourceSummary[] {
    const bySource = new Map<string, RawRow[]>();
    for (const row of rows) {
        const cs = row.content_source;
        if (!bySource.has(cs)) bySource.set(cs, []);
        bySource.get(cs)!.push(row);
    }

    const summaries: SourceSummary[] = [];
    for (const [cs, csRows] of bySource) {
        const success = csRows.filter((r) => r.response === 'success');
        const errors = csRows.filter((r) => r.response !== 'success');
        const lastError =
            errors.length > 0 ? (errors[errors.length - 1].response ?? null) : null;

        const toNum = (v: unknown): number => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        };

        const totalPkgsReturned = csRows.reduce(
            (sum, r) => sum + toNum(r.num_packages_returned),
            0
        );
        const totalPkgsBlocked = csRows.reduce(
            (sum, r) => sum + toNum(r.num_packages_blocked),
            0
        );
        const totalPkgsWon = csRows.reduce(
            (sum, r) => sum + toNum(r.num_packages_won),
            0
        );

        const rtValues = csRows
            .map((r) => toNum(r.response_time_ms))
            .filter((v) => v > 0);
        const avgRt =
            rtValues.length > 0
                ? rtValues.reduce((a, b) => a + b, 0) / rtValues.length
                : null;

        const dates = csRows
            .map((r) => r.date_added)
            .filter((d): d is string => !!d)
            .sort();

        let status: 'ok' | 'error' | 'mixed' = 'ok';
        if (success.length === 0) status = 'error';
        else if (errors.length > 0) status = 'mixed';

        summaries.push({
            content_source: cs,
            status,
            attempt_count: csRows.length,
            success_count: success.length,
            error_count: errors.length,
            last_error_response: lastError,
            packages_returned: totalPkgsReturned,
            packages_blocked: totalPkgsBlocked,
            packages_won: totalPkgsWon,
            avg_response_time_ms: avgRt !== null ? Math.round(avgRt) : null,
            first_seen: dates[0] ?? null,
            last_seen: dates[dates.length - 1] ?? null,
        });
    }

    return summaries.sort((a, b) =>
        a.content_source.localeCompare(b.content_source)
    );
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));

    if (!flags.transactionId && !flags.sql) {
        emitError('missing_join_key', {
            detail:
                '--transaction-id / --search-hash is required, or pass --sql with a custom query.',
        });
    }

    const searchId = flags.transactionId!;
    const windowHours = flags.windowHours;

    const sql =
        flags.sql ??
        `
        SELECT
            content_source,
            search_type,
            response,
            num_packages_returned,
            num_packages_blocked,
            num_packages_won,
            response_time_ms,
            date_added
        FROM ${TABLE}
        WHERE
            search_id = '${searchId.replace(/'/g, "''")}'
            AND date_added >= now() - INTERVAL ${windowHours} HOUR
        ORDER BY date_added ASC
        `.trim();

    log(`search_id: ${searchId}`);
    log(`window_hours: ${windowHours}`);
    log(`table: ${TABLE}`);

    let rows: Record<string, unknown>[];
    try {
        rows = await clickhouseQuery(sql);
    } catch (e) {
        emitError('clickhouse_query_failed', { detail: String(e), sql });
    }

    const typedRows = rows as RawRow[];
    const sourcesSummary = summariseSources(typedRows);

    log(`rows: ${typedRows.length} | sources: ${sourcesSummary.length}`);

    emitOk({
        join_key: {
            transaction_id: searchId,
            search_hash: searchId,
            window_hours: windowHours,
        },
        table: TABLE,
        sql,
        sources_called: sourcesSummary,
        clickhouse_rows: typedRows,
    });
}

main();
