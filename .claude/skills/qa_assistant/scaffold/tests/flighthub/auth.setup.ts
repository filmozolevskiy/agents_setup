import { test as setup } from '../../fixtures/pom/test-options';
import { createFlighthubStorageState } from '../../helpers/flighthub/createStorageState';

setup('bootstrap flighthub session', async ({ page }) => {
    await createFlighthubStorageState(page);
});
