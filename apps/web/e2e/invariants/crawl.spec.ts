import { expect, test } from '@playwright/test';
import { OWNER_STATE } from '../env';
import { expectDrillParity, expectNoZeroForUnknown, expectShekelLeftOfDigits, expectTotalsMatchRows } from '../helpers';

/**
 * G-16 slice b · the cross-surface crawl (GAP-PACKAGES G-16 §1), he + en at 390
 * and 1440, as the demo owner on the lab seed. Warn mode: violations are logged
 * per page (G16_MODE=error fails them, W4-01).
 *
 * SCAFFOLD, off by default: it runs only with G16_CRAWL=1. It switches on once
 * W2-08 (homes/nav) and W2-09 (DrillLink, data-drill*) are on main and the screens
 * carry the data-money-* markers (see ./logic.ts). ROUTES then grows to the full
 * nav registry. The legal links are checked now, since they need no markers.
 */

const CRAWL = process.env.G16_CRAWL === '1';
const LEGAL = ['/privacy', '/terms', '/cookies', '/accessibility'];
/** Interim route list. Slice b replaces it with the nav registry. */
const ROUTES = ['/dashboard', '/dashboard/leaks', '/dashboard/approvals', '/dashboard/recovery', '/dashboard/suppliers'];
const SIZES = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '1440', viewport: { width: 1440, height: 900 } },
] as const;

test.describe('G-16 crawl', () => {
  test.skip(!CRAWL, 'G-16 slice b scaffold: set G16_CRAWL=1 to run');
  test.use({ storageState: OWNER_STATE });

  test('legal links are present and answer 200', async ({ page, request }) => {
    await page.goto('/');
    for (const path of LEGAL) {
      await expect(page.locator(`a[href="${path}"]`).first(), `${path} linked from /`).toBeAttached();
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });

  for (const locale of ['he', 'en'] as const) {
    for (const size of SIZES) {
      test(`invariants · ${locale} · ${size.name}`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: 'rm_locale', value: locale, url: baseURL! }]);
        await page.setViewportSize(size.viewport);
        let violations = 0;
        for (const route of ROUTES) {
          await page.goto(route);
          violations += (await expectTotalsMatchRows(page)).length;
          violations += (await expectNoZeroForUnknown(page)).length;
          if (locale === 'he') violations += (await expectShekelLeftOfDigits(page)).length;
          violations += (await expectDrillParity(page)).length;
        }
        console.warn(`[G-16] crawl ${locale}/${size.name}: ${violations} violation(s) on ${ROUTES.length} routes`);
      });
    }
  }
});
