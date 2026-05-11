#!/usr/bin/env node
/**
 * qa-validate — Evidence dump across MySQL / ClickHouse / MongoDB.
 *
 * No pass/fail verdicts — evidence only. The agent applies
 * references/validation_checklist.md field-by-field after reading
 * the output.
 *
 * Stdout: single JSON object with `mysql`, `clickhouse`, `mongodb` keys.
 * Stderr: progress logs.
 *
 * Usage:
 *   cd .cursor/skills/qa_assistant/scaffold
 *   npx tsx runners/qa-validate.ts --booking-id 297983572
 *   npx tsx runners/qa-validate.ts --id-hash 2F3abc...
 *   npx tsx runners/qa-validate.ts --transaction-id abc123def456
 */

import dotenv from 'dotenv';
import path from 'path';
import { emitOk, emitError, log } from './_lib/stdout';
import { mysqlQuery, clickhouseQuery, mongoFind, mongoAggregate } from './_lib/db';

dotenv.config({ path: path.resolve(process.cwd(), '../../../../.env') });

interface JoinKeys {
    bookingId?: number;
    idHash?: string;
    transactionId?: string;
}

function parseFlags(argv: string[]): {
    joinKeys: JoinKeys;
    mongoLimit: number;
    searchTelemetryWindowHours: number;
} {
    const joinKeys: JoinKeys = {};
    let mongoLimit = 10;
    let searchTelemetryWindowHours = 24;

    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        const pick = (name: string): string | undefined => {
            if (tok === `--${name}`) return argv[++i];
            if (tok.startsWith(`--${name}=`))
                return tok.slice(`--${name}=`.length);
            return undefined;
        };

        const bid = pick('booking-id');
        if (bid !== undefined) { joinKeys.bookingId = parseInt(bid, 10); continue; }
        const ih = pick('id-hash');
        if (ih !== undefined) { joinKeys.idHash = ih; continue; }
        const tid = pick('transaction-id');
        if (tid !== undefined) { joinKeys.transactionId = tid; continue; }
        const ml = pick('mongo-limit');
        if (ml !== undefined) { mongoLimit = parseInt(ml, 10); continue; }
        const wh = pick('search-telemetry-window-hours');
        if (wh !== undefined) {
            searchTelemetryWindowHours = parseInt(wh, 10);
            continue;
        }
    }

    return { joinKeys, mongoLimit, searchTelemetryWindowHours };
}

function sq(s: string): string {
    return s.replace(/'/g, "''");
}

async function resolveBookingId(keys: JoinKeys): Promise<{
    bookingId: number;
    idHash: string | null;
    transactionId: string | null;
}> {
    if (keys.bookingId) {
        const rows = await mysqlQuery(
            `SELECT id, id_hash, debug_transaction_id FROM ota.bookings WHERE id = ${keys.bookingId} LIMIT 1`
        );
        if (rows.length === 0) {
            emitError('booking_not_found', {
                detail: `No booking found with id=${keys.bookingId}`,
            });
        }
        const row = rows[0];
        return {
            bookingId: keys.bookingId,
            idHash: (row.id_hash as string) ?? null,
            transactionId: (row.debug_transaction_id as string) ?? null,
        };
    }

    if (keys.idHash) {
        const rows = await mysqlQuery(
            `SELECT id, id_hash, debug_transaction_id FROM ota.bookings WHERE id_hash = '${sq(keys.idHash)}' LIMIT 1`
        );
        if (rows.length === 0) {
            emitError('booking_not_found', {
                detail: `No booking found with id_hash='${keys.idHash}'`,
            });
        }
        const row = rows[0];
        return {
            bookingId: row.id as number,
            idHash: keys.idHash,
            transactionId: (row.debug_transaction_id as string) ?? null,
        };
    }

    if (keys.transactionId) {
        const rows = await mysqlQuery(
            `SELECT id, id_hash, debug_transaction_id FROM ota.bookings WHERE debug_transaction_id = '${sq(keys.transactionId)}' LIMIT 1`
        );
        if (rows.length === 0) {
            emitError('booking_not_found', {
                detail: `No booking found with debug_transaction_id='${keys.transactionId}'`,
            });
        }
        const row = rows[0];
        return {
            bookingId: row.id as number,
            idHash: (row.id_hash as string) ?? null,
            transactionId: keys.transactionId,
        };
    }

    emitError('missing_join_key', {
        detail: 'One of --booking-id, --id-hash, --transaction-id is required.',
    });
}

async function main(): Promise<void> {
    const { joinKeys, mongoLimit, searchTelemetryWindowHours } = parseFlags(
        process.argv.slice(2)
    );

    if (!joinKeys.bookingId && !joinKeys.idHash && !joinKeys.transactionId) {
        emitError('missing_join_key', {
            detail:
                'One of --booking-id, --id-hash, --transaction-id is required.',
        });
    }

    log('resolving booking id...');
    const { bookingId, idHash, transactionId } =
        await resolveBookingId(joinKeys);

    log(
        `booking_id=${bookingId} id_hash=${idHash ?? 'unknown'} transaction_id=${transactionId ?? 'unknown'}`
    );

    // ── MySQL ────────────────────────────────────────────────────────────────

    log('querying mysql...');

    const bid = bookingId;
    const [
        bookingsRows,
        contestantsRows,
        passengersRows,
        segmentsRows,
        statementItemsRows,
        statementTransactionsRows,
        tasksRows,
        bookabilityAttemptsRows,
        bookabilityCustomerAttemptsRows,
        payhubCaptureRows,
        payhubLedgerRows,
        agencyFopRows,
    ] = await Promise.all([
        mysqlQuery(
            `SELECT * FROM ota.bookings WHERE id = ${bid} LIMIT 1`
        ),
        mysqlQuery(
            `SELECT * FROM ota.booking_contestants WHERE booking_id = ${bid}`
        ),
        mysqlQuery(
            `SELECT * FROM ota.booking_passengers WHERE booking_id = ${bid}`
        ),
        mysqlQuery(
            `SELECT * FROM ota.booking_segments WHERE booking_id = ${bid} ORDER BY position`
        ),
        mysqlQuery(
            `SELECT * FROM ota.booking_statement_items WHERE booking_id = ${bid}`
        ),
        mysqlQuery(
            `SELECT * FROM ota.booking_statement_transactions WHERE booking_id = ${bid} ORDER BY id`
        ),
        mysqlQuery(
            `SELECT * FROM ota.booking_tasks WHERE booking_id = ${bid} ORDER BY id DESC LIMIT 20`
        ),
        transactionId
            ? mysqlQuery(
                  `SELECT * FROM ota.bookability_contestant_attempts WHERE search_hash = '${sq(transactionId)}' ORDER BY id DESC LIMIT 20`
              )
            : Promise.resolve([]),
        transactionId
            ? mysqlQuery(
                  `SELECT * FROM ota.bookability_customer_attempts WHERE search_hash = '${sq(transactionId)}' ORDER BY id DESC LIMIT 10`
              )
            : Promise.resolve([]),
        // Payhub capture summary
        mysqlQuery(
            `SELECT
                CAST(COALESCE(SUM(amount), 0) AS CHAR) AS sum,
                COUNT(*) AS row_count,
                GROUP_CONCAT(DISTINCT currency ORDER BY currency SEPARATOR ',') AS currency_set,
                GROUP_CONCAT(DISTINCT billing_info_id ORDER BY billing_info_id SEPARATOR ',') AS billing_info_ids
            FROM ota.booking_statement_transactions
            WHERE booking_id = ${bid}
              AND processor = 'payhub'
              AND type = 'auth_capture'
              AND status = 'success'`
        ),
        // Payhub ledger summary
        mysqlQuery(
            `SELECT
                CAST(COALESCE(SUM(customer_amount), 0) AS CHAR) AS sum,
                COUNT(*) AS row_count,
                GROUP_CONCAT(DISTINCT currency ORDER BY currency SEPARATOR ',') AS currency_set,
                GROUP_CONCAT(DISTINCT billing_info_id ORDER BY billing_info_id SEPARATOR ',') AS billing_info_ids
            FROM ota.booking_statement_items
            WHERE booking_id = ${bid}
              AND payment_processor = 'payhub'
              AND transaction_type = 'sale'
              AND status = 'paid'`
        ),
        // Agency supplier payout FOP
        mysqlQuery(
            `SELECT
                (SELECT COUNT(*) FROM ota.booking_statement_transactions
                 WHERE booking_id = ${bid} AND processor = 'payhub'
                   AND type = 'auth_capture' AND status = 'success') AS payhub_capture_count,
                (SELECT GROUP_CONCAT(DISTINCT billing_info_id ORDER BY billing_info_id SEPARATOR ',')
                 FROM ota.booking_statement_items
                 WHERE booking_id = ${bid} AND payment_processor = 'payhub'
                   AND transaction_type = 'sale' AND status = 'paid') AS payhub_billing_info_ids,
                (SELECT GROUP_CONCAT(DISTINCT bsi.billing_info_id ORDER BY bsi.billing_info_id SEPARATOR ',')
                 FROM ota.booking_statement_items bsi
                 WHERE bsi.booking_id = ${bid}
                   AND bsi.payment_processor = 'agency'
                   AND bsi.transaction_type = 'sale'
                   AND bsi.fop = 'credit_card'
                   AND NOT EXISTS (
                       SELECT 1 FROM ota.booking_virtual_card_statement_items bvcsi
                       WHERE bvcsi.booking_statement_item_id = bsi.id
                   )) AS agency_cc_billing_info_ids`
        ),
    ]);

    log('mysql done');

    // ── ClickHouse ───────────────────────────────────────────────────────────

    log('querying clickhouse...');

    const chSearchId = transactionId ?? '';

    const [chBookingErrors, chSearchTelemetry] = await Promise.all([
        transactionId
            ? clickhouseQuery(
                  `SELECT * FROM jupiter.jupiter_booking_errors_v2
                   WHERE search_id = '${sq(transactionId)}'
                   ORDER BY timestamp ASC
                   LIMIT 50`
              )
            : Promise.resolve([]),
        chSearchId
            ? clickhouseQuery(
                  `SELECT
                      content_source, search_type, response,
                      num_packages_returned, num_packages_blocked, num_packages_won,
                      response_time_ms, date_added
                   FROM search_api_stats.gds_raw
                   WHERE search_id = '${sq(chSearchId)}'
                     AND date_added >= now() - INTERVAL ${searchTelemetryWindowHours} HOUR
                   ORDER BY date_added ASC`
              )
            : Promise.resolve([]),
    ]);

    log('clickhouse done');

    // ── MongoDB ──────────────────────────────────────────────────────────────

    log('querying mongodb...');

    const mongoFilter = transactionId
        ? { transaction_id: transactionId }
        : {};

    const [debugLogsDocs, debugLogsCountResult, optimizerLogsCountResult] =
        await Promise.all([
            transactionId
                ? mongoFind('debug_logs', mongoFilter, {
                      limit: mongoLimit,
                      sort: { _id: -1 },
                      projection: {
                          _id: 1,
                          context: 1,
                          content_source: 1,
                          booking_step: 1,
                          date_added: 1,
                      },
                  })
                : Promise.resolve([]),
            transactionId
                ? mongoAggregate('debug_logs', [
                      { $match: mongoFilter },
                      { $count: 'count' },
                  ])
                : Promise.resolve([{ count: 0 }]),
            transactionId
                ? mongoAggregate('optimizer_logs', [
                      { $match: mongoFilter },
                      { $count: 'count' },
                  ])
                : Promise.resolve([{ count: 0 }]),
        ]);

    log('mongodb done');

    // ── Aggregate payment summaries ──────────────────────────────────────────

    const toStr = (v: unknown): string => String(v ?? '0');
    const toIds = (v: unknown): number[] => {
        const s = String(v ?? '');
        if (!s) return [];
        return s
            .split(',')
            .map((x) => parseInt(x.trim(), 10))
            .filter((n) => !isNaN(n));
    };

    const payhubCapture = payhubCaptureRows[0] ?? {};
    const payhubLedger = payhubLedgerRows[0] ?? {};
    const agencyFop = agencyFopRows[0] ?? {};

    const payhubCurrencySet = String(payhubCapture.currency_set ?? '')
        .split(',')
        .filter(Boolean);
    const ledgerCurrencySet = String(payhubLedger.currency_set ?? '')
        .split(',')
        .filter(Boolean);

    // Count debug_logs
    const debugLogsCountDoc = debugLogsCountResult[0] as
        | { count?: number }
        | undefined;
    const debugLogsCount = debugLogsCountDoc?.count ?? 0;

    const optimizerCountDoc = optimizerLogsCountResult[0] as
        | { count?: number }
        | undefined;
    const optimizerLogsCount = optimizerCountDoc?.count ?? 0;

    emitOk({
        join_keys: {
            booking_id: bookingId,
            id_hash: idHash,
            debug_transaction_id: transactionId,
        },
        mysql: {
            bookings: bookingsRows[0] ?? null,
            booking_contestants: contestantsRows,
            booking_passengers: passengersRows,
            booking_segments: segmentsRows,
            booking_statement_items: statementItemsRows,
            booking_statement_transactions: statementTransactionsRows,
            booking_tasks: tasksRows,
            bookability_contestant_attempts_for_search: bookabilityAttemptsRows,
            bookability_customer_attempts_for_search:
                bookabilityCustomerAttemptsRows,
            payhub_capture_summary: {
                sum: toStr(payhubCapture.sum),
                currency_set: payhubCurrencySet,
                row_count: Number(payhubCapture.row_count ?? 0),
                billing_info_ids: toIds(payhubCapture.billing_info_ids),
            },
            payhub_ledger_summary: {
                sum: toStr(payhubLedger.sum),
                currency_set: ledgerCurrencySet,
                row_count: Number(payhubLedger.row_count ?? 0),
                billing_info_ids: toIds(payhubLedger.billing_info_ids),
            },
            agency_supplier_payout_fop: {
                payhub_capture_count: Number(agencyFop.payhub_capture_count ?? 0),
                payhub_billing_info_ids: toIds(agencyFop.payhub_billing_info_ids),
                agency_cc_billing_info_ids: toIds(
                    agencyFop.agency_cc_billing_info_ids
                ),
            },
        },
        clickhouse: {
            jupiter_booking_errors_v2: chBookingErrors,
            search_telemetry_rows: chSearchTelemetry,
            search_telemetry_table: 'search_api_stats.gds_raw',
            search_telemetry_window_hours: searchTelemetryWindowHours,
        },
        mongodb: {
            debug_logs_count: debugLogsCount,
            debug_logs_top: debugLogsDocs,
            optimizer_logs_count: optimizerLogsCount,
        },
    });
}

main();
