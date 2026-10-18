import { test as setup } from '@playwright/test';
import { DEMO_OWNER_EMAIL, OWNER_STATE } from './env';
import { loginViaMagicLink } from './helpers';

/** Signs the seeded demo owner in once; smoke specs reuse the saved session. */
setup('sign in as the demo owner', async ({ page }) => {
  await loginViaMagicLink(page, DEMO_OWNER_EMAIL, '/dashboard');
  await page.waitForURL(/\/dashboard/);
  await page.context().storageState({ path: OWNER_STATE });
});
