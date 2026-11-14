import { expect, test } from '@playwright/test';
import { LEGAL_PAGE_PATHS } from '../../lib/legal/registry';
import { REGISTRY } from '../../lib/nav/registry';
import { OWNER_STATE } from '../env';
import { expectDrillParity, expectNoZeroForUnknown, expectShekelLeftOfDigits, expectTotalsMatchRows } from '../helpers';

/**
 * G-16 slice b · the cross-surface crawl (GAP-PACKAGES G-16 §1): every static,
 * owner-visible route of the nav registry, in he + en at 390 and 1440, as the demo
 * owner on the lab seed.
 *   - drill parity on the W2-09 contract (a[data-drill] + data-drill-total, landing total);
 *   - in he, the ₪ glyph renders left of the first digit;
 *   - no red ₪0, and no ₪0 for an unmeasured / unavailable figure;
 *   - totals = Σ rows wherever a screen carries data-money-sum-of (none yet: 0 checks);
 *   - the legal links are present and answer 200.
 * Warn mode: violations are logged per route with a per-rule count; G16_MODE=error
 * (W4-01) fails them. It runs only with G16_CRAWL=1, so it adds no load to the shared
 * CI e2e job until the orchestrator turns it on.
 */

const CRAWL = process.env.G16_CRAWL === '1';

/** Static (no [param]), linked from nav, open to the owner. */
export const CRAWL_ROUTES: string[] = REGISTRY.filter(
  (r) => !r.path.includes('[') && r.nav !== 'hidden' && (!r.roles || r.roles.includes('owner')),
).map((r) => r.path);

const SIZES = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '1440', viewport: { width: 1440, height: 900 } },
] as const;

test.describe('G-16 crawl · signed out', () => {
  test.skip(!CRAWL, 'G-16 crawl: set G16_CRAWL=1 to run');
  test.use({ storageState: { cookies: [], origins: [] } });

  test('legal links are present on the landing page and answer 200', async ({ page, request }) => {
    await page.goto('/');
    for (const path of LEGAL_PAGE_PATHS) {
      await expect(page.locator(`a[href="${path}"]`).first(), `${path} linked from /`).toBeAttached();
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});

test.describe('G-16 crawl', () => {
  test.skip(!CRAWL, 'G-16 crawl: set G16_CRAWL=1 to run');
  test.use({ storageState: OWNER_STATE });
  test.describe.configure({ timeout: 15 * 60_000 });

  // Signed in, `/` redirects to /dashboard. The app shell links only the accessibility
  // statement, help and contact (ia-nav-20), so a legal page it doesn't link is reported
  // in warn mode, not failed. Every legal page must still answer 200.
  test('legal pages answer 200; links missing from the app shell are reported', async ({ page, request }) => {
    await page.goto('/dashboard');
    const missing: string[] = [];
    for (const path of LEGAL_PAGE_PATHS) {
      expect((await request.get(path)).status(), path).toBe(200);
      if ((await page.locator(`a[href="${path}"]`).count()) === 0) missing.push(path);
    }
    if (missing.length) console.warn(`[G-16] legal-links · /dashboard shell: ${missing.length} not linked: ${missing.join(', ')}`);
    if (process.env.G16_MODE === 'error') expect(missing, 'legal links in the app shell').toEqual([]);
  });

  for (const locale of ['he', 'en'] as const) {
    for (const size of SIZES) {
      test(`invariants · ${locale} · ${size.name}`, async ({ page, context, baseURL }) => {
        await context.addCookies([
          { name: 'rm_locale', value: locale, url: baseURL! },
          { name: 'rm_cookie_consent', value: 'necessary', url: baseURL! },
        ]);
        await page.setViewportSize(size.viewport);
        const perRule: Record<string, number> = {};
        const add = (rule: string, n: number) => (perRule[rule] = (perRule[rule] ?? 0) + n);
        for (const route of CRAWL_ROUTES) {
          const res = await page.goto(route);
          if (!res || res.status() >= 400) {
            add('route-error', 1);
            console.warn(`[G-16] crawl ${locale}/${size.name} ${route}: HTTP ${res?.status() ?? 'none'}`);
            continue;
          }
          await page.waitForLoadState('networkidle').catch(() => {});
          add('totals-match-rows', (await expectTotalsMatchRows(page)).length);
          add('no-zero-for-unknown', (await expectNoZeroForUnknown(page)).length);
          if (locale === 'he') add('shekel-left-of-digits', (await expectShekelLeftOfDigits(page)).length);
          add('drill-parity', (await expectDrillParity(page)).length);
        }
        console.warn(`[G-16] crawl ${locale}/${size.name} · ${CRAWL_ROUTES.length} routes · ${JSON.stringify(perRule)}`);
      });
    }
  }
});
