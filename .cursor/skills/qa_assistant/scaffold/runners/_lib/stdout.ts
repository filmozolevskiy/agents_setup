/**
 * Stdout helpers for per-phase runners.
 *
 * Every runner emits exactly ONE JSON object on stdout. Logs go to stderr.
 * `emitError` writes the error object and exits non-zero — callers never
 * reach the statement after it (TypeScript `never`).
 */

export function emitOk(payload: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

export function emitError(
    error: string,
    extras?: Record<string, unknown>
): never {
    process.stdout.write(
        JSON.stringify({ error, ...extras }, null, 2) + '\n'
    );
    process.exit(1);
}

export function log(message: string): void {
    process.stderr.write(`[qa-runner] ${message}\n`);
}
