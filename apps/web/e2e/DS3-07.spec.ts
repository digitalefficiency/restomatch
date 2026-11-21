import { expect, test, type Page } from '@playwright/test';
import { ACTIVE_FACE, faces, fontPreloads } from '@restomatch/ui-tokens';
import { OWNER_STATE } from './env';
import { collectPageErrors } from './helpers';

/**
 * DS3-07 · the UI typeface. An owner decision in the form of a pull request: Google Sans
 * replaces IBM Plex Sans Hebrew; the undo is `ACTIVE_FACE = 'plex'` in
 * packages/ui-tokens/src/fonts.ts. Every check reads the active face from there, so the
 * spec holds for either face:
 *   1. the face draws every Hebrew, Latin, digit and ₪ glyph on the home and the approvals desk (he, en);
 *   2. ₪, geresh, gershayim and maqaf come from the face in every weight, in text and in the number role;
 *   3. the number role has fixed-width digits in every weight (Google Sans has them only with 'tnum');
 *   4. a page preloads exactly fontPreloads() for its language, and nothing of another face loads;
 *   5. when the face arrives late, the metric-matched fallback keeps the swap within the DS2 gate (CLS ≤ 0.01).
 */

const FAMILY = ACTIVE_FACE === 'heebo' ? 'Heebo' : faces[ACTIVE_FACE].family;
const FACE_DIR = ACTIVE_FACE === 'heebo' ? '/fonts/heebo/' : `${faces[ACTIVE_FACE].dir}/`;
/** CDP reports the family name inside the font file ('Google Sans 18pt', 'IBM Plex Sans Hebrew'). */
const IN_FACE = new RegExp(`^${FAMILY}`, 'i');
const WEIGHTS = [400, 500, 600, 700] as const;
/**
 * Text the face covers: Hebrew, Latin, digits, ₪, the punctuation the product writes, and the bidi
 * marks formatIls puts around a Hebrew amount (U+200E, U+200F, U+2066–U+2069).
 */
const COVERED = /^[\p{Script=Hebrew}\p{Script=Latin}\p{Nd}\s₪.,:;!?%()[\]{}'"’‘“”\-–—־׳״/·•+−×=@#&*|<>…\u200E\u200F\u2066-\u2069]+$/u;

async function setLang(page: Page, lang: string) {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: lang, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

/** The platform font families CDP reports for every element matching `selector`. */
async function platformFamilies(page: Page, selector: string): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
  const families = new Set<string>();
  for (const nodeId of nodeIds) {
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    for (const f of fonts) families.add(f.familyName);
  }
  await cdp.detach();
  return [...families];
}

test.describe(`DS3-07 · the UI face (${FAMILY})`, () => {
  test.use({ storageState: OWNER_STATE });

  for (const lang of ['he', 'en'] as const) {
    test(`1 · the face draws every glyph and every ₪ on the home and the approvals desk (${lang})`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await setLang(page, lang);
      for (const route of ['/dashboard', '/dashboard/approvals']) {
        await page.goto(route);
        await settle(page);
        const marked = await page.evaluate((source) => {
          const covered = new RegExp(source, 'u');
          let money = 0;
          let n = 0;
          for (const el of document.querySelectorAll('main *')) {
            if (el.closest('svg,script,style,.sr-only,[aria-hidden="true"]')) continue;
            const own = [...el.childNodes].filter((c) => c.nodeType === 3 && c.nodeValue!.trim());
            if (!own.length) continue;
            const text = own.map((c) => c.nodeValue).join('');
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || !covered.test(text.trim())) continue;
            el.setAttribute('data-ds307', '');
            if (text.includes('₪')) money++;
            n++;
          }
          return { n, money };
        }, COVERED.source);
        expect(marked.n, `${route}: text elements checked`).toBeGreaterThan(10);
        // Amounts are among them (their digits and ₪ are checked below with the rest).
        expect(marked.money, `${route}: amounts checked`).toBeGreaterThan(0);
        const families = await platformFamilies(page, '[data-ds307]');
        expect(families.filter((f) => !IN_FACE.test(f)), `${route} (${lang}) drew glyphs outside ${FAMILY}: ${families.join(', ')}`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  }

  test('2 · ₪, geresh, gershayim and maqaf come from the face in every weight, also in the number role', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto('/dashboard');
    await settle(page);
    await page.evaluate((weights) => {
      const host = document.createElement('div');
      host.id = 'ds307-marks';
      for (const w of weights) {
        for (const cls of ['', 'num']) {
          const s = document.createElement('span');
          s.className = cls;
          s.style.fontWeight = String(w);
          s.setAttribute('data-ds307-mark', '');
          // ₪ U+20AA · geresh U+05F3 · gershayim U+05F4 · maqaf U+05BE, alone and inside words.
          s.textContent = '₪ ׳ ״ ־ צ׳יפס ש״ח דו־שבועי ₪1,234.56';
          host.appendChild(s);
        }
      }
      document.querySelector('main')!.appendChild(host);
    }, WEIGHTS);
    await page.evaluate(() => document.fonts.ready);
    const families = await platformFamilies(page, '[data-ds307-mark]');
    expect(families.length).toBeGreaterThan(0);
    expect(families.filter((f) => !IN_FACE.test(f)), families.join(', ')).toEqual([]);
  });

  test('3 · the number role has fixed-width digits in every weight', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto('/dashboard');
    await settle(page);
    const widths = await page.evaluate(async ({ weights, family }) => {
      // Load the face at every weight first: a face with a file per weight (Plex) loads 500/600 on demand.
      await Promise.all(weights.map((w) => document.fonts.load(`${w} 40px "${family}"`, '0123456789')));
      const host = document.createElement('div');
      document.querySelector('main')!.appendChild(host);
      const measure = (text: string, cls: string, weight: number) => {
        const s = document.createElement('span');
        s.className = cls;
        s.style.cssText = `font-size:40px;font-weight:${weight};white-space:nowrap`;
        s.textContent = text;
        host.appendChild(s);
        const w = s.getBoundingClientRect().width;
        s.remove();
        return w;
      };
      const runs = ['0000000000', '1111111111', '4444444444', '7777777777'];
      return weights.map((w) => ({
        weight: w,
        num: runs.map((t) => measure(t, 'num', w)),
        tabularNums: runs.map((t) => measure(t, 'tabular-nums', w)),
        plain: runs.map((t) => measure(t, '', w)),
      }));
    }, { weights: WEIGHTS, family: FAMILY });
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    for (const w of widths) {
      expect(spread(w.num), `.num digits at ${w.weight}: ${w.num.join(', ')}`).toBeLessThanOrEqual(0.5);
      expect(spread(w.tabularNums), `tabular-nums digits at ${w.weight}: ${w.tabularNums.join(', ')}`).toBeLessThanOrEqual(0.5);
    }
    // A bold total lines up with a regular row: the same digit width in every weight.
    expect(spread(widths.map((w) => w.num[0] ?? 0))).toBeLessThanOrEqual(0.5);
    if (ACTIVE_FACE === 'google-sans') {
      // Why the number role matters: Google Sans's own digits are proportional ('1' is narrower than '0').
      for (const w of widths) expect(spread(w.plain), `plain digits at ${w.weight}`).toBeGreaterThan(20);
    }
  });

  test('4 · the page preloads its language’s files, and nothing of another face loads', async ({ page }) => {
    const fontFiles: string[] = [];
    page.on('response', (r) => {
      if (r.url().endsWith('.woff2')) fontFiles.push(new URL(r.url()).pathname);
    });
    const expected = fontPreloads();
    for (const lang of ['he', 'en'] as const) {
      await setLang(page, lang);
      fontFiles.length = 0;
      await page.goto('/dashboard/approvals');
      await settle(page);
      const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((ls) => ls.map((l) => new URL((l as HTMLLinkElement).href).pathname));
      expect([...new Set(preloads)].sort(), `preloads (${lang})`).toEqual([...expected[lang]].sort());
      expect(fontFiles.length, `font files (${lang})`).toBeGreaterThan(0);
      // Every interface font file this page fetched belongs to the active face.
      expect(fontFiles.filter((f) => !f.startsWith(FACE_DIR)), `font files (${lang})`).toEqual([]);
    }
  });

  test('5 · a late face swaps in without moving the layout (CLS ≤ 0.01, DS2 gate)', async ({ page, browser }) => {
    const baseURL = test.info().project.use.baseURL!;
    for (const [route, width] of [
      ['/dashboard', 1440],
      ['/dashboard/approvals', 1440],
      ['/dashboard/approvals', 390],
    ] as const) {
      // Warm: compile the route under next dev before measuring.
      await setLang(page, 'he');
      await page.goto(route);
      await settle(page);
      // Measure in a fresh context (empty cache), holding every font file back so the
      // metric-matched fallback paints first and the face swaps in late.
      const ctx = await browser.newContext({ storageState: OWNER_STATE, locale: 'he-IL', viewport: { width, height: width < 600 ? 844 : 900 } });
      await ctx.addCookies([
        { name: 'rm_locale', value: 'he', url: baseURL },
        { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
      ]);
      await ctx.route('**/*.woff2', async (r) => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await r.continue();
      });
      await ctx.addInitScript(() => {
        const w = window as unknown as { __shifts: { t: number; v: number }[] };
        w.__shifts = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { hadRecentInput: boolean; startTime: number; value: number }[]) {
            if (!e.hadRecentInput) w.__shifts.push({ t: e.startTime, v: e.value });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      const p = await ctx.newPage();
      await p.goto(baseURL + route);
      await settle(p);
      await p.waitForTimeout(500);
      const r = await p.evaluate(() => {
        const fonts = performance.getEntriesByType('resource').filter((e) => e.name.endsWith('.woff2'));
        const fontsAt = Math.min(...fonts.map((e) => (e as PerformanceResourceTiming).responseEnd));
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
        const shifts = (window as unknown as { __shifts: { t: number; v: number }[] }).__shifts;
        const swap = shifts.filter((s) => s.t >= fontsAt - 50).reduce((n, s) => n + s.v, 0);
        return { fonts: fonts.length, fontsAt, fcp, swap, all: shifts.reduce((n, s) => n + s.v, 0) };
      });
      await ctx.close();
      expect(r.fonts, `${route} @${width}: fonts fetched`).toBeGreaterThan(0);
      // The check only means something if text painted before the face arrived.
      expect(r.fontsAt, `${route} @${width}: the face arrived after the first paint`).toBeGreaterThan(r.fcp);
      expect(r.swap, `${route} @${width}: layout shift when the face swapped in (all shifts ${r.all.toFixed(4)})`).toBeLessThanOrEqual(0.01);
    }
  });
});

test.describe('DS3-07 · a receiver language the face draws', () => {
  test('ru preloads its own list (Cyrillic when the face has it); the other receiver languages keep their base list', async ({ page }) => {
    const expected = fontPreloads();
    for (const [lang, list] of [
      ['ru', expected.ru ?? expected.en],
      ['ar', expected.en],
    ] as const) {
      await setLang(page, lang);
      await page.goto('/login');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((ls) => ls.map((l) => new URL((l as HTMLLinkElement).href).pathname));
      expect([...new Set(preloads)].sort(), `preloads (${lang})`).toEqual([...list].sort());
    }
  });
});
