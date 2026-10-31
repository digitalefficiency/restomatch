import { test } from '@playwright/test';
import { OWNER_STATE } from './env';

/**
 * TEMPORARY diagnostic (W2-15 fix request, lab-baseline): prints, per lab
 * section, its height and every system (non-web) font that draws text in it,
 * at he 390 and he 1440, so the CI-only +44 px can be located. Removed in the
 * fix commit.
 */
test.use({ storageState: OWNER_STATE });

for (const width of [390, 1440]) {
  test(`diag lab sections he-${width}`, async ({ page }) => {
    const url = test.info().project.use.baseURL!;
    await page.context().addCookies([
      { name: 'rm_locale', value: 'he', url },
      { name: 'rm_cookie_consent', value: 'necessary', url },
    ]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/dashboard/lab/tokens?density=default');
    await page.evaluate(() => document.fonts.ready);
    const info = await page.evaluate(() => {
      const lab = document.querySelector('[data-lab="tokens"]') as HTMLElement;
      const sections = [...lab.children].map((s) => ({
        name: (s.querySelector('h1,h2')?.textContent ?? s.tagName).slice(0, 24),
        h: Math.round(s.getBoundingClientRect().height),
      }));
      const banner = document.querySelector('#main-content [role="status"]');
      return {
        lab: Math.round(lab.getBoundingClientRect().height),
        sections,
        banner: banner ? Math.round(banner.getBoundingClientRect().height) : 0,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    });
    console.log(`DIAG-${width}`, JSON.stringify(info));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-lab="tokens"] *' });
    const sys: Record<string, string[]> = {};
    for (const id of nodeIds) {
      try {
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id });
        const own = fonts.filter((f) => !f.isCustomFont);
        if (!own.length) continue;
        const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId: id });
        for (const f of own) {
          const list = (sys[f.familyName] ??= []);
          if (list.length < 6) list.push(`${f.glyphCount}g:${outerHTML.replace(/<[^>]+>/g, '').slice(0, 40)}`);
        }
      } catch {
        /* node without layout */
      }
    }
    console.log(`DIAG-FONTS-${width}`, JSON.stringify(sys));
  });
}
