import { expect, test } from '@playwright/test';
import { OWNER_STATE } from './env';

/**
 * With the wave-1 flags on (the seeded demo tenant has features.all) an owner
 * has ~17 desktop tabs — wider than the header. They must all stay reachable:
 * the row wraps, it never clips tabs behind a hidden scrollbar (UI review).
 */
test.use({ storageState: OWNER_STATE, viewport: { width: 1366, height: 900 } });

for (const locale of ['he', 'en'] as const) {
  test(`desktop nav: every tab sits inside the row at 1366 px with all flags on (${locale})`, async ({ page }) => {
    await page.context().addCookies([{ name: 'rm_locale', value: locale, url: test.info().project.use.baseURL! }]);
    await page.goto('/dashboard');
    const row = page.getByTestId('desktop-nav-row');
    await expect(row).toBeVisible();
    const links = row.locator('a[href^="/dashboard"]');
    const n = await links.count();
    expect(n, 'flags on: more tabs than the 11 base ones').toBeGreaterThan(11);
    const box = (await row.boundingBox())!;
    for (let i = 0; i < n; i++) {
      const link = links.nth(i);
      const b = (await link.boundingBox())!;
      const label = (await link.textContent())?.trim();
      expect(b.x, `${label} starts inside the row`).toBeGreaterThanOrEqual(box.x - 1);
      expect(b.x + b.width, `${label} ends inside the row`).toBeLessThanOrEqual(box.x + box.width + 1);
      const onTop = await link.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return Boolean(hit && (hit === el || el.contains(hit)));
      });
      expect(onTop, `${label} is not clipped or covered`).toBe(true);
    }
  });
}
