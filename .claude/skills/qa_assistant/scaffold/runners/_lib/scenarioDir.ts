import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Creates a timestamped scenario directory for screenshots and artefacts.
 * Lives under `reports/<UTC-timestamp>-<label>/` relative to the scaffold
 * root (the `reports/` tree is gitignored).
 *
 * @param label - Human-readable suffix (e.g. `"amadeus-smoke"`, `"qa-cleanup"`).
 * @returns Absolute path to the created directory.
 */
export function createScenarioDir(label: string): string {
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
    const name = `${timestamp}-${label}`;
    const dir = path.resolve(process.cwd(), 'reports', name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Returns the path to an artefact inside a scenario dir, creating any
 * missing parent dirs.
 */
export function scenarioPath(
    scenarioDir: string,
    filename: string
): string {
    return path.join(scenarioDir, filename);
}
