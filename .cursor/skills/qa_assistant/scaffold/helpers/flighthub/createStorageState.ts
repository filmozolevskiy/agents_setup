import type { Page } from '@playwright/test';
import { flighthubConfig } from '../../config/flighthub';
import { StorageStatePaths } from '../../enums/flighthub/flighthub';

/**
 * Bootstraps a Flighthub `storageState` — booking does not require login,
 * so this only dismisses the cookie-consent banner so every test starts
 * on a quiet page. Output is `StorageStatePaths.FLIGHTHUB`.
 *
 * @param page - Playwright `Page` from the setup project.
 * @returns Promise that resolves once storage state is written.
 */
export async function createFlighthubStorageState(page: Page): Promise<void> {
    await page.goto(flighthubConfig.appUrl ?? '');

    // Osano CMP banner uses the same `.osano-cm-button--type_denyAll`
    // class on staging2 (button text "Reject All") and prod (button text
    // "Reject Non-Essential"). A `getByRole('button', { name: 'Reject All' })`
    // lookup silently misses on prod and leaves the cookie state un-set,
    // so every prod test then has to re-dismiss the banner mid-run. The
    // class-based locator dismisses both. Osano mounts async, so race the
    // click with a short timeout instead of `isVisible()`.
    // eslint-disable-next-line playwright/no-raw-locators -- Osano banner exposes no role/label, only this class.
    const rejectAll = page.locator('.osano-cm-button--type_denyAll');

    try {
        await rejectAll.click({ timeout: 5000 });
    } catch {
        // Banner did not appear in this session — fall through.
    }

    await page.context().storageState({ path: StorageStatePaths.FLIGHTHUB });
}
