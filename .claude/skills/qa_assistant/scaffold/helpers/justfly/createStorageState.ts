import type { Page } from '@playwright/test';
import { justflyConfig } from '../../config/justfly';
import { StorageStatePaths } from '../../enums/justfly/justfly';

/**
 * Bootstraps a JustFly `storageState` — booking does not require login,
 * so this only dismisses the cookie-consent banner so every test starts
 * on a quiet page. Output is `StorageStatePaths.JUSTFLY`.
 *
 * @param page - Playwright `Page` from the setup project.
 * @returns Promise that resolves once storage state is written.
 */
export async function createJustflyStorageState(page: Page): Promise<void> {
    await page.goto(justflyConfig.appUrl ?? '');

    // Osano CMP banner uses the same `role='dialog'` with name
    // 'Cookie Consent Banner' on both environments, but the deny button
    // text differs: 'Reject All' on staging2 and 'Reject Non-Essential'
    // on prod. The `/^Reject/i` regex covers both without dropping the
    // dialog scope or the role-based lookup. Osano mounts async, so race
    // the click with a short timeout instead of `isVisible()`.
    const cookieBanner = page.getByRole('dialog', {
        name: 'Cookie Consent Banner',
    });
    const rejectAll = cookieBanner.getByRole('button', { name: /^Reject/i });

    try {
        await rejectAll.click({ timeout: 5000 });
    } catch {
        // Banner did not appear in this session — fall through.
    }

    await page.context().storageState({ path: StorageStatePaths.JUSTFLY });
}
