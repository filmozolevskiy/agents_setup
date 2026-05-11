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
    const context = await browser.newContext(
        storageStatePath ? { storageState: storageStatePath } : {}
    );
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
