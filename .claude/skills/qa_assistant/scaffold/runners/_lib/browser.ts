import { chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Mode } from '../../fixtures/helper/bookingInputs';

export interface BrowserSession {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    close(): Promise<void>;
}

/**
 * Realistic Chrome user-agent. The default Playwright UA (`HeadlessChrome/...`)
 * triggers upstream supplier bot-heuristics that strip TravelFusion (and
 * likely other non-GDS sources) from the response — verified empirically on
 * staging99 YUL→LIS 2026-06-17 CAD: default UA returns 0 TF packages winning
 * the front-end dedup; real Chrome UA returns 20/20. Update the version
 * occasionally to track current Chrome.
 */
const REAL_CHROME_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Launches a Chromium browser for UI-mode runners (`ui-headless` or
 * `ui-headed`). Not used for `--mode api` (no browser needed).
 *
 * Viewport and locale defaults mirror the Playwright project config so
 * screenshots look consistent with the Playwright test suite.
 *
 * @param mode - Must be `'ui-headless'` or `'ui-headed'`.
 * @param storageStatePath - Optional path to a saved storage-state JSON
 *   (authenticated session). Pass `undefined` to start anonymous.
 */
export async function launchBrowser(
    mode: Exclude<Mode, 'api'>,
    storageStatePath?: string
): Promise<BrowserSession> {
    const headless = mode === 'ui-headless';
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext({
        userAgent: REAL_CHROME_UA,
        viewport: { width: 1440, height: 900 },
        ...(storageStatePath ? { storageState: storageStatePath } : {}),
    });
    const page = await context.newPage();

    return {
        browser,
        context,
        page,
        async close() {
            await context.close();
            await browser.close();
        },
    };
}
