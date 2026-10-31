import { expect, test } from '@playwright/test';
import { OWNER_STATE } from './env';

/**
 * With the wave-1 flags on (the seeded demo tenant has features.all) an owner
 * has ~23 nav entries. The shell v2 sidebar (W1-03) holds them in job-ordered
 * groups: every entry stays reachable (in view or by scrolling the sidebar,
 * never clipped or covered), nothing wraps into a second header row, and the
 * page starts high (the old 2-row tab strip cost 152 px).
 */
test.use({ storageState: OWNER_STATE });

for (const width of [1366, 1440]) {
  for (const locale of ['he', 'en'] as const) {
    test(`sidebar: every entry reachable, one 56 px top bar, content top ≤ 180 px at ${width} (${locale})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.context().addCookies([
        { name: 'rm_locale', value: locale, url: test.info().project.use.baseURL! },
        { name: 'rm_cookie_consent', value: 'necessary', url: test.info().project.use.baseURL! },
      ]);
      await page.goto('/dashboard');
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      const sidebar = page.getByTestId('sidebar');
      await expect(sidebar).toBeVisible();
      // Open every collapsed group so each entry renders.
      for (const toggle of await sidebar.locator('button[aria-expanded="false"]').all()) await toggle.click();
      const links = sidebar.locator('nav a[href^="/dashboard"]');
      const n = await links.count();
      expect(n, 'flags on: more entries than the 11 base ones').toBeGreaterThan(11);
      const box = (await sidebar.boundingBox())!;
      for (let i = 0; i < n; i++) {
        const link = links.nth(i);
        await link.scrollIntoViewIfNeeded();
        const b = (await link.boundingBox())!;
        const label = (await link.textContent())?.trim();
        expect(b.x, `${label} starts inside the sidebar`).toBeGreaterThanOrEqual(box.x - 1);
        expect(b.x + b.width, `${label} ends inside the sidebar`).toBeLessThanOrEqual(box.x + box.width + 1);
        const onTop = await link.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return Boolean(hit && (hit === el || el.contains(hit)));
        });
        expect(onTop, `${label} is not clipped or covered`).toBe(true);
      }
      expect((await page.locator('header').first().boundingBox())!.height).toBeLessThanOrEqual(56);
      const top = await page.locator('#main-content > div').evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeLessThanOrEqual(180);
    });
  }
}
