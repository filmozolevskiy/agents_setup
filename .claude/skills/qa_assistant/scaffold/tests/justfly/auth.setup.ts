import { test as setup } from '../../fixtures/pom/test-options';
import { createJustflyStorageState } from '../../helpers/justfly/createStorageState';

setup('bootstrap justfly session', async ({ page }) => {
    await createJustflyStorageState(page);
});
