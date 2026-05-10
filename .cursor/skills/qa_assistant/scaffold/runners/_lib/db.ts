/**
 * Shared DB helpers for QA DB shell runners (qa-validate, qa-search-telemetry).
 *
 * MySQL:      mysql2 (already a scaffold dependency) — fastest, structured JSON.
 * ClickHouse: spawns clickhouse_query.py --json — no CH client in package.json.
 * MongoDB:    spawns mongo_query.py --json — Extended JSON via bson.json_util.
 *
 * The Python scripts live two levels above the scaffold root:
 *   .cursor/skills/db_access/scripts/
 * All spawned calls inherit process.env, which the caller must populate by
 * calling loadEnv() (or dotenv.config()) before invoking these helpers.
 */

import { spawn } from 'child_process';
import path from 'path';
import mysql from 'mysql2/promise';

// Resolved from CWD (scaffold root when invoked via `npx tsx runners/...`).
const DB_SCRIPTS = path.resolve(
    process.cwd(),
    '..',
    '..',
    'db_access',
    'scripts'
);

function runPythonJson(
    script: string,
    args: string[]
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            'python3',
            [path.join(DB_SCRIPTS, script), ...args],
            { env: process.env }
        );

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(
                    new Error(
                        `${script} exited with code ${code}. stderr: ${stderr.slice(0, 500)}`
                    )
                );
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(
                    new Error(
                        `${script} stdout is not JSON: ${stdout.slice(0, 200)}`
                    )
                );
            }
        });

        child.on('error', (err) => {
            reject(new Error(`Failed to spawn ${script}: ${String(err)}`));
        });
    });
}

export async function mysqlQuery(
    sql: string
): Promise<Record<string, unknown>[]> {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST ?? 'localhost',
        port: parseInt(process.env.MYSQL_PORT ?? '3306', 10),
        user: process.env.MYSQL_USER ?? 'root',
        password: process.env.MYSQL_PASSWORD ?? '',
        database: process.env.MYSQL_DATABASE ?? 'ota',
        decimalNumbers: true,
    });
    try {
        const [rows] = await conn.execute(sql);
        return rows as Record<string, unknown>[];
    } finally {
        await conn.end();
    }
}

export async function clickhouseQuery(
    sql: string
): Promise<Record<string, unknown>[]> {
    const result = await runPythonJson('clickhouse_query.py', [
        'query',
        '--json',
        sql,
    ]);
    return result as Record<string, unknown>[];
}

export async function mongoFind(
    collection: string,
    filter: Record<string, unknown>,
    {
        limit = 10,
        sort,
        projection,
    }: {
        limit?: number;
        sort?: Record<string, number>;
        projection?: Record<string, number>;
    } = {}
): Promise<unknown[]> {
    const args = ['find', collection, '--json', '--limit', String(limit)];
    if (Object.keys(filter).length > 0) {
        args.push('--filter', JSON.stringify(filter));
    }
    if (sort) args.push('--sort', JSON.stringify(sort));
    if (projection) args.push('--projection', JSON.stringify(projection));
    const result = await runPythonJson('mongo_query.py', args);
    return result as unknown[];
}

export async function mongoAggregate(
    collection: string,
    pipeline: Record<string, unknown>[]
): Promise<unknown[]> {
    const result = await runPythonJson('mongo_query.py', [
        'aggregate',
        collection,
        JSON.stringify(pipeline),
        '--json',
    ]);
    return result as unknown[];
}
