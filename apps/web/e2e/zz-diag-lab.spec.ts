import { expect, test } from '@playwright/test';
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
      const sections = [...lab.children].map((s) => Math.round(s.getBoundingClientRect().height));
      // Element-level heights inside the two sections that differ in CI (colors = 1, feedback = 13).
      const walk = (el: Element, depth: number, out: string[]) => {
        for (const c of [...el.children]) {
          const r = c.getBoundingClientRect();
          if (r.height >= 12) out.push(`${depth}:${c.tagName.toLowerCase()}:${Math.round(r.height)}:${(c.textContent ?? '').trim().slice(0, 14)}`);
          if (depth < 4) walk(c, depth + 1, out);
        }
        return out;
      };
      const detail = [1, 13].map((i) => walk(lab.children[i]!, 0, []));
      const banner = document.querySelector('#main-content [role="status"]');
      return {
        lab: Math.round(lab.getBoundingClientRect().height),
        sections,
        detail,
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
        const { object } = await cdp.send('DOM.resolveNode', { nodeId: id });
        const text = object.objectId
          ? ((await cdp.send('Runtime.callFunctionOn', {
              objectId: object.objectId,
              functionDeclaration: 'function () { return (this.textContent || "").slice(0, 40); }',
              returnByValue: true,
            })).result.value as string)
          : '';
        for (const f of own) {
          const list = (sys[f.familyName] ??= []);
          if (list.length < 6) list.push(`${f.glyphCount}g:${text}`);
        }
      } catch {
        /* node without layout */
      }
    }
    console.log(`DIAG-FONTS-${width}`, JSON.stringify(sys));
    // Fail on purpose so the numbers land in the end-of-run summary (the full CI log is not downloadable here).
    const browser = page.context().browser()?.version() ?? '?';
    expect(`DIAG ${width} chromium=${browser} ${JSON.stringify(info)} fonts=${JSON.stringify(sys)}`).toBe('');
  });
}
