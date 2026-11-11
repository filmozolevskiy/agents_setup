#!/usr/bin/env node
/* eslint-disable playwright/no-raw-locators, playwright/no-networkidle */
/**
 * Throwaway probe: logs into staging Summit and downloads one or more
 * `data-exchange-debug/{uuid}` payloads via the authenticated session.
 *
 * Those URLs come back from a `fares-<source>/fetch` replay call
 * (`?get_gds_exchange=1` already present on the Summit-printed api_url)
 * and point at the raw supplier request / response. TTL is ~3600s.
 *
 * Not wired into package.json scripts — invoke directly:
 *   npx tsx runners/_probes/summit-fetch-exchange.ts \
 *     --out reports/_stdio/acndc/ \
 *     --name rq --url https://staging2-summit.flighthub.com/data-exchange-debug/<uuid> \
 *     --name rs --url https://staging2-summit.flighthub.com/data-exchange-debug/<uuid>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadEnv } from '../_lib/envLoader';
import { launchBrowser } from '../_lib/browser';

interface Pair { name: string; url: string }

function parseFlags(argv: string[]): { out?: string; pairs: Pair[] } {
    const pairs: Pair[] = [];
    let out: string | undefined;
    let pendingName: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (tok === '--out') { out = argv[++i]; continue; }
        if (tok === '--name') { pendingName = argv[++i]; continue; }
        if (tok === '--url') {
            const url = argv[++i];
            pairs.push({ name: pendingName ?? `payload-${pairs.length + 1}`, url });
            pendingName = undefined;
            continue;
        }
    }
    return { out, pairs };
}

const SUMMIT_URL = process.env.SUMMIT_URL ?? 'https://staging2-summit.flighthub.com';

async function main(): Promise<void> {
    const { out, pairs } = parseFlags(process.argv.slice(2));
    if (!out || pairs.length === 0) {
        process.stderr.write('Usage: --out <dir> [--name <label> --url <url>] ...\n');
        process.exit(2);
    }
    loadEnv('flighthub-staging2');
    const user = process.env.SUMMIT_USER;
    const pass = process.env.SUMMIT_PASS;
    if (!user || !pass) {
        process.stderr.write('SUMMIT_USER / SUMMIT_PASS not set in .env\n');
        process.exit(2);
    }

    fs.mkdirSync(out, { recursive: true });
    const session = await launchBrowser('ui-headless');

    try {
        await session.page.goto(SUMMIT_URL);
        await session.page.locator('#email').fill(user);
        await session.page.locator('#password').fill(pass);
        await session.page.locator('#process-login').click();
        await session.page.waitForLoadState('networkidle');

        const results: { name: string; url: string; bytes: number; saved_to: string; content_type: string }[] = [];
        for (const { name, url } of pairs) {
            const resp = await session.context.request.get(url);
            const ct = resp.headers()['content-type'] ?? '';
            const buf = await resp.body();
            const ext = ct.includes('xml')
                ? '.xml'
                : ct.includes('json')
                  ? '.json'
                  : '.txt';
            const file = path.join(out, `${name}${ext}`);
            fs.writeFileSync(file, buf);
            results.push({ name, url, bytes: buf.length, saved_to: file, content_type: ct });
        }
        process.stdout.write(JSON.stringify({ out, payloads: results }, null, 2) + '\n');
    } finally {
        await session.close();
    }
}

main().catch((e) => {
    process.stderr.write(`fatal: ${e}\n`);
    process.exit(1);
});
