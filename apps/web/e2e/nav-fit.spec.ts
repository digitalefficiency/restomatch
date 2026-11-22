import { expect, test } from '@playwright/test';
import { OWNER_STATE } from './env';

/**
 * With the wave-1 flags on (the seeded demo tenant has features.all) an owner
 * has ~25 nav entries. The side menu holds them in job-ordered groups: every
 * entry stays reachable (in view or by scrolling the menu, never clipped or
 * covered), nothing wraps into a second header row, and the page starts high
 * (the old 2-row tab strip cost 152 px). DS3-02: the fit rule folds the least
 * recently opened group when the list would overflow, so groups are opened and
 * checked one at a time.
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
      // DS3-02 fit rule (sidebar spec §4.2): opening a group may fold the least recently opened one, never the
      // group just opened. So open each group in turn and check its entries right after it opened.
      const box = (await sidebar.boundingBox())!;
      let n = 0;
      const check = async (scope: ReturnType<typeof sidebar.locator>) => {
        const links = scope.locator('a[href^="/dashboard"]');
        const count = await links.count();
        for (let i = 0; i < count; i++) {
          const link = links.nth(i);
          if (!(await link.isVisible())) continue;
          n += 1;
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
      };
      await check(sidebar.locator('nav ul').first());
      for (const header of await sidebar.locator('nav button[data-nav-group]').all()) {
        if ((await header.getAttribute('aria-expanded')) === 'false') await header.click();
        const group = await header.getAttribute('data-nav-group');
        await check(sidebar.locator(`[data-group="${group}"]`));
      }
      expect(n, 'flags on: more entries than the 11 base ones').toBeGreaterThan(11);
      expect((await page.locator('header').first().boundingBox())!.height).toBeLessThanOrEqual(56);
      const top = await page.locator('#main-content > div').evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeLessThanOrEqual(180);
    });
  }
}
