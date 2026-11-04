#!/usr/bin/env node
/* eslint-disable playwright/no-raw-locators, playwright/no-networkidle */
/**
 * Throwaway exploration runner: logs into Summit on staging, navigates to
 * `/flight-search/info/<hash>`, and dumps `#flightSearchStats` HTML to disk
 * so the parser can be built against actual DOM (not a guess).
 *
 * Not wired into package.json scripts on purpose — invoke directly via
 *   npx tsx runners/_probes/summit-inspect.ts --search-hash <hash>
 * once or twice, copy the saved HTML out, then delete or leave here as a
 * forensic tool for selector rot.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnv } from '../_lib/envLoader';
import { launchBrowser } from '../_lib/browser';

const SUMMIT_URL =
    process.env.SUMMIT_URL ?? 'https://staging2-summit.flighthub.com';

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    let searchHash: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--search-hash') searchHash = argv[++i];
    }
    if (!searchHash) {
        process.stderr.write('Usage: summit-inspect --search-hash <hash>\n');
        process.exit(2);
    }

    loadEnv('flighthub-staging2');
    const user = process.env.SUMMIT_USER;
    const pass = process.env.SUMMIT_PASS;
    if (!user || !pass) {
        process.stderr.write('SUMMIT_USER / SUMMIT_PASS not set in .env\n');
        process.exit(2);
    }

    const session = await launchBrowser('ui-headless');
    const out = path.resolve(
        process.cwd(),
        `reports/_stdio/summit-probe-${searchHash}`
    );
    fs.mkdirSync(out, { recursive: true });

    try {
        await session.page.goto(SUMMIT_URL);
        await session.page.locator('#email').fill(user);
        await session.page.locator('#password').fill(pass);
        await session.page.locator('#process-login').click();
        await session.page.waitForLoadState('networkidle');

        await session.page.goto(
            `${SUMMIT_URL}/flight-search/info/${searchHash}`
        );
        await session.page.waitForLoadState('networkidle');

        const statsHtml = await session.page
            .locator('#flightSearchStats')
            .innerHTML()
            .catch(() => '<MISSING #flightSearchStats>');
        fs.writeFileSync(path.join(out, 'flightSearchStats.html'), statsHtml);

        const urlStatsHtml = await session.page
            .locator('#flightSearchStats fieldset#urlStats')
            .innerHTML()
            .catch(() => '<MISSING fieldset#urlStats>');
        fs.writeFileSync(path.join(out, 'urlStats.html'), urlStatsHtml);

        await session.page.screenshot({
            path: path.join(out, 'page.png'),
            fullPage: true,
        });

        process.stdout.write(JSON.stringify({ out }, null, 2) + '\n');
    } finally {
        await session.close();
    }
}

main().catch((e) => {
    process.stderr.write(`fatal: ${e}\n`);
    process.exit(1);
});
