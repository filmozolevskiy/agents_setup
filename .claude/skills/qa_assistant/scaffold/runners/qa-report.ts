#!/usr/bin/env node
/**
 * qa-report — Render a QA validation report.md from classified records.
 *
 * Reads JSON from stdin (or --input file), writes report.md to the
 * scenario_dir, and emits a single JSON object on stdout.
 *
 * Input shape (from references/report_format.md):
 *   {
 *     "header": {
 *       "booking_id": 297983572,
 *       "env": "production",
 *       "site": "flighthub",
 *       "content_source": "amadeus",
 *       "route": "YUL-LAX",
 *       "depart": "2026-07-15",
 *       "scenario_dir": "..."
 *     },
 *     "records": [
 *       {
 *         "booking_id": 297983572,
 *         "validation": "bookings.is_test = 1",
 *         "verdict": "PASS",
 *         "explanation": "flagged as test booking",
 *         "proof": "`SELECT id_hash, is_test FROM ota.bookings WHERE id = 297983572`"
 *       }
 *     ]
 *   }
 *
 * Stdout: {"report_path": "...", "overall_verdict": "PASS", "validations_count": N}
 *
 * Usage:
 *   cat records.json | npx tsx runners/qa-report.ts
 *   npx tsx runners/qa-report.ts --input records.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { emitOk, emitError } from './_lib/stdout';

const VERDICT_RANK: Record<string, number> = {
    FAIL: 3,
    AMBIGUOUS: 2,
    SKIPPED: 1,
    PASS: 0,
};

interface ReportHeader {
    booking_id?: number | string;
    env?: string;
    site?: string;
    content_source?: string;
    route?: string;
    depart?: string;
    scenario_dir?: string;
    [key: string]: unknown;
}

interface ReportRecord {
    booking_id?: number | string;
    validation: string;
    verdict: string;
    explanation: string;
    proof: string;
}

interface ReportInput {
    header: ReportHeader;
    records: ReportRecord[];
}

function parseFlags(argv: string[]): { inputFile?: string } {
    const flags: { inputFile?: string } = {};
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (tok === '--input') { flags.inputFile = argv[++i]; continue; }
        if (tok.startsWith('--input=')) {
            flags.inputFile = tok.slice('--input='.length);
        }
    }
    return flags;
}

function escapeCell(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
}

function overallVerdict(records: ReportRecord[]): string {
    if (records.length === 0) return 'SKIPPED';
    let best = 0;
    for (const r of records) {
        const rank = VERDICT_RANK[r.verdict.toUpperCase()] ?? 0;
        if (rank > best) best = rank;
    }
    return (
        Object.entries(VERDICT_RANK).find(([, v]) => v === best)?.[0] ?? 'PASS'
    );
}

function renderMarkdown(input: ReportInput): string {
    const h = input.header;
    const records = input.records;
    const verdict = overallVerdict(records);

    const headerLine = [
        h.booking_id ? `booking \`${h.booking_id}\`` : null,
        h.env ? `env \`${h.env}\`` : null,
        h.site ? `site \`${h.site}\`` : null,
        h.content_source ? `content source \`${h.content_source}\`` : null,
        h.route && h.depart ? `${h.route} on ${h.depart}` : null,
    ]
        .filter(Boolean)
        .join(' — ');

    const lines: string[] = [
        '# QA Validation Report',
        '',
        headerLine ? `${headerLine}.` : '',
        '',
        `Overall verdict: **${verdict}** (${records.length} validation${records.length === 1 ? '' : 's'} run).`,
        '',
        h.scenario_dir ? `Scenario dir: \`${h.scenario_dir}\`` : '',
        '',
        '| Booking ID | Validation | Verdict | Explanation | Proof |',
        '|------------|------------|---------|-------------|-------|',
    ];

    for (const r of records) {
        const cells = [
            escapeCell(String(r.booking_id ?? h.booking_id ?? '')),
            escapeCell(r.validation),
            escapeCell(r.verdict.toUpperCase()),
            escapeCell(r.explanation),
            escapeCell(r.proof),
        ];
        lines.push(`| ${cells.join(' | ')} |`);
    }

    return lines.filter((l) => l !== undefined).join('\n') + '\n';
}

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));

    let raw: string;
    if (flags.inputFile) {
        try {
            raw = fs.readFileSync(path.resolve(flags.inputFile), 'utf8');
        } catch (e) {
            emitError('input_file_read_failed', {
                detail: String(e),
                file: flags.inputFile,
            });
        }
    } else {
        // Read from stdin.
        raw = await new Promise<string>((resolve, reject) => {
            let buf = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk: string) => { buf += chunk; });
            process.stdin.on('end', () => { resolve(buf); });
            process.stdin.on('error', reject);
        });
    }

    let input: ReportInput;
    try {
        input = JSON.parse(raw) as ReportInput;
    } catch (e) {
        emitError('invalid_json_input', {
            detail: `Failed to parse input JSON: ${String(e)}`,
        });
    }

    if (!input.header || !Array.isArray(input.records)) {
        emitError('invalid_input_shape', {
            detail: 'Input must have "header" (object) and "records" (array).',
        });
    }

    const md = renderMarkdown(input);
    const verdict = overallVerdict(input.records);

    const scenarioDir = input.header.scenario_dir;
    if (!scenarioDir) {
        emitError('missing_scenario_dir', {
            detail: 'header.scenario_dir is required to know where to write report.md.',
        });
    }

    const reportPath = path.join(scenarioDir as string, 'report.md');
    try {
        fs.mkdirSync(scenarioDir as string, { recursive: true });
        fs.writeFileSync(reportPath, md, 'utf8');
    } catch (e) {
        emitError('report_write_failed', {
            detail: String(e),
            report_path: reportPath,
        });
    }

    emitOk({
        report_path: reportPath,
        overall_verdict: verdict,
        validations_count: input.records.length,
    });
}

main();
