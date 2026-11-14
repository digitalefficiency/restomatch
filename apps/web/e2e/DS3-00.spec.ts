import { expect, test, type Page } from '@playwright/test';
import { channels, colorVars, colorVarsV2, elevation, focus, motion, status, surfaces, text } from '@restomatch/ui-tokens';
import { labHe } from '../app/dashboard/lab/tokens/copy';
import { OWNER_STATE } from './env';

/**
 * DS3-00 · the clean finish's tokens, checked in a real browser (docs/ux/ds3/WORKPLAN.md §DS3-00,
 * SPEC §2, §4, §8). The token values themselves are pinned by packages/ui-tokens' unit tests; this
 * spec proves the build ships them and the product renders through them:
 *  1. every colour variable on :root equals the token source (no stale or hand-written override);
 *  2. focus: a 2 px outline in the focus colour with a 2 px offset; white on an opted-in dark
 *     surface; inset on an opted-in row; the system Highlight in forced-colours mode;
 *  3. elevation: a resting card is sh1, a floating layer (the toast) is sh2;
 *  4. tiers: T3 money is green, no money figure is red, pending is muted;
 *  5. motion variables are SPEC §8's (confirmed, not duplicated);
 *  6. home and the token lab hold AA (4.5:1) on every text node, at 1440 and 390.
 */

const LAB = '/dashboard/lab/tokens';
const rgb = (hex: string) => `rgb(${channels(hex).split(' ').join(', ')})`;

test.use({ storageState: OWNER_STATE });

async function setLang(page: Page, lang: 'he' | 'en') {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: lang, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

/** Tailwind's shadow utilities prepend the (transparent) ring layers; compare the shadow itself. */
const shadowOnly = (v: string) => v.replace(/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px,\s*/g, '');
/** CSS minifiers rewrite times and curves (100ms → .1s, 0.2 → .2): compare numbers, not spellings. */
const ms = (v: string) => (v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
const curve = (v: string) => (v.match(/-?\d*\.?\d+/g) ?? []).map(Number);

/** The browser's own serialisation of a CSS value (so shadows compare exactly). */
async function computed(page: Page, prop: 'boxShadow' | 'color', value: string): Promise<string> {
  return page.evaluate(
    ([p, v]) => {
      const d = document.createElement('div');
      (d.style as unknown as Record<string, string>)[p] = v;
      document.body.append(d);
      const out = (getComputedStyle(d) as unknown as Record<string, string>)[p]!;
      d.remove();
      return out;
    },
    [prop, value] as const,
  );
}

test.describe('1 · the build ships the token source', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('every --c-* variable on :root equals packages/ui-tokens (v1 and v2 names)', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto('/dashboard');
    const want: Record<string, string> = {};
    for (const [name, hex] of Object.entries(colorVars())) want[`--c-${name}`] = channels(hex);
    for (const [name, hex] of Object.entries(colorVarsV2())) want[`--c-${name}`] = channels(hex);
    const got = await page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
    }, Object.keys(want));
    expect(got).toEqual(want);
  });

  test('the page itself paints the canvas and the ink', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto('/dashboard');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(rgb(surfaces.canvas));
    expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(rgb(text.ink));
  });

  test('motion is SPEC §8: 100 · 150 · 240 · 400 ms and the three curves, emitted once', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto('/dashboard');
    const vars = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const read = (n: string) => cs.getPropertyValue(n).trim();
      return {
        micro: read('--dur-micro'),
        short: read('--dur-short'),
        medium: read('--dur-medium'),
        long: read('--dur-long'),
        standard: read('--ease-standard'),
        enter: read('--ease-enter'),
        exit: read('--ease-exit'),
        duplicate: ['--t-press', '--t-state', '--t-panel', '--t-explain', '--e-std', '--e-out', '--e-exit'].filter((n) => read(n) !== ''),
      };
    });
    expect(vars.duplicate).toEqual([]);
    for (const k of ['micro', 'short', 'medium', 'long'] as const) expect(ms(vars[k]), k).toBe(ms(motion.duration[k]));
    for (const k of ['standard', 'enter', 'exit'] as const) expect(curve(vars[k]), k).toEqual(curve(motion.easing[k]));
  });
});

test.describe('2 · focus', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Tab stops on home show a 2 px outline in the focus colour with a 2 px offset', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto('/dashboard');
    await page.locator('main').first().waitFor();
    let checked = 0;
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        if (r.width * r.height === 0) return null;
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, color: cs.outlineColor };
      });
      if (!f) continue;
      expect.soft(f).toEqual({ style: 'solid', width: '2px', offset: '2px', color: rgb(focus) });
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  test('a dark surface that opts in (data-focus="on-dark") turns the outline white; forced colours use Highlight', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.setAttribute('data-focus', 'on-dark');
      host.innerHTML = '<button type="button" id="ds3-dark-probe">probe</button>';
      document.body.append(host);
    });
    const probe = page.locator('#ds3-dark-probe');
    await probe.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions));
    expect(await probe.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(rgb(text.onBold));

    await page.emulateMedia({ forcedColors: 'active' });
    const highlight = await computed(page, 'color', 'Highlight');
    await probe.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions));
    const forced = await probe.evaluate((el) => ({ color: getComputedStyle(el).outlineColor, width: getComputedStyle(el).outlineWidth }));
    expect(forced).toEqual({ color: highlight, width: '2px' });
  });

  test('a row inside a scroll container that opts in (data-focus="inset") draws the same outline inside itself', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<button type="button" id="ds3-inset-probe" data-focus="inset">probe</button>';
      document.body.append(host);
    });
    const probe = page.locator('#ds3-inset-probe');
    await probe.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions));
    expect(await probe.evaluate((el) => ({ offset: getComputedStyle(el).outlineOffset, width: getComputedStyle(el).outlineWidth, color: getComputedStyle(el).outlineColor }))).toEqual({
      offset: '-2px',
      width: '2px',
      color: rgb(focus),
    });
  });
});

test.describe('3 · elevation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the lab: e1 is sh1, e2 and e3 are sh2; a toast floats on sh2', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setLang(page, 'he');
    await page.goto(`${LAB}?density=default`);
    for (const e of ['e1', 'e2', 'e3'] as const) {
      const box = page.locator(`[data-lab="tokens"] .shadow-${e}`).first();
      expect(shadowOnly(await box.evaluate((el) => getComputedStyle(el).boxShadow)), e).toBe(await computed(page, 'boxShadow', elevation[e]));
    }
    await page.getByRole('button', { name: labHe.showToast }).click();
    const toast = page.locator('[data-toast]').first();
    await expect(toast).toBeVisible();
    expect(shadowOnly(await toast.evaluate((el) => getComputedStyle(el).boxShadow))).toBe(await computed(page, 'boxShadow', elevation.e2));
  });

  test('home: every card drawn with the legacy card shadow now rests on sh1', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto('/dashboard');
    const sh1 = await computed(page, 'boxShadow', elevation.e1);
    const cards = await page.locator('main .shadow-card').evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow));
    expect(cards.length, 'home draws at least one legacy card').toBeGreaterThan(0);
    for (const s of cards) expect(shadowOnly(s)).toBe(sh1);
  });
});

test.describe('4 · tiers keep their meaning', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the lab money states: T3 green, T1/T2 ink, pending and zero muted, never red', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    const section = page.locator('section[aria-labelledby="lab-money-states"]');
    await expect(section).toBeVisible();
    const colours = await section.locator('li').evaluateAll((items) =>
      Object.fromEntries(
        items.map((li) => {
          const state = li.querySelector('span')?.textContent?.trim() ?? '';
          // The figure: the innermost element that holds a digit.
          let fig: Element | null = null;
          for (const el of li.querySelectorAll('*')) if (/\d/.test(el.textContent ?? '') && el.children.length === 0) fig = el;
          return [state, fig ? getComputedStyle(fig).color : ''];
        }),
      ),
    );
    const T3 = rgb(status.gold.text);
    expect(colours.caught).toBe(T3);
    expect(colours.returned).toBe(T3);
    expect(colours.claimed).toBe(rgb(status.primary.text));
    expect(colours.credited).toBe(rgb(status.primary.text));
    for (const s of ['leak', 'atRisk', 'outstanding', 'spend']) expect(colours[s], s).toBe(rgb(text.ink));
    for (const s of ['pending', 'zero']) expect(colours[s], s).toBe(rgb(text.muted));
    for (const [s, c] of Object.entries(colours)) {
      expect(c, `${s} is never red`).not.toBe(rgb(status.danger.text));
      expect(c, `${s} is never red`).not.toBe(rgb(status.danger.bgBold));
    }
  });

  test('wherever a page uses the T3 family as text, it renders green (home, credit requests)', async ({ page }) => {
    await setLang(page, 'he');
    for (const path of ['/dashboard', '/dashboard/recovery']) {
      await page.goto(path);
      await page.locator('main').first().waitFor();
      const golds = await page.locator('main .text-gold').evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
      for (const c of golds) expect(c, path).toBe(rgb(status.gold.text));
    }
  });
});

/** Every visible text node vs every colour its background can take (gradients composited). */
async function lowContrast(page: Page) {
  return page.evaluate(() => {
    const parse = (s: string) => {
      const m = String(s).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
      if (!m) return null;
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a };
    };
    type C = { r: number; g: number; b: number; a: number };
    const over = (t: C, b: C): C => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = (c: C) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a: C, b: C) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const bgs = (el: Element | null): C[] => {
      if (!el || el === document.documentElement) {
        const h = parse(getComputedStyle(document.documentElement).backgroundColor);
        return [h && h.a > 0 ? { ...h, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }];
      }
      const cs = getComputedStyle(el);
      const under = bgs(el.parentElement);
      let layers: C[] = [];
      if (cs.backgroundImage.includes('gradient')) layers = (cs.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).map(parse).filter(Boolean) as C[];
      const bc = parse(cs.backgroundColor);
      if (!layers.length && bc && bc.a > 0) layers = [bc];
      if (!layers.length) return under;
      return layers.flatMap((l) => under.map((u) => over(l, u)));
    };
    const out: string[] = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let nd = tw.nextNode(); nd; nd = tw.nextNode()) {
      if (!nd.nodeValue?.trim()) continue;
      const el = nd.parentElement;
      if (!el || el.closest('script,style,noscript,[hidden],.sr-only,[aria-hidden="true"],[disabled],[aria-disabled="true"]')) continue;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      let op = 1;
      for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const col = parse(cs.color);
      if (!col) continue;
      col.a *= op;
      const worst = Math.min(...bgs(el).map((bg) => ratio(over(col, bg), bg)));
      const fs = parseFloat(cs.fontSize);
      const need = fs >= 24 || (fs >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700) ? 3 : 4.5;
      if (worst < need) out.push(`${worst.toFixed(2)} < ${need}: «${nd.nodeValue.trim().slice(0, 30)}»`);
    }
    return out;
  });
}

for (const vp of [
  { name: '1440', viewport: { width: 1440, height: 900 }, isMobile: false },
  { name: '390', viewport: { width: 390, height: 844 }, isMobile: true },
]) {
  test.describe(`6 · AA on every text node · ${vp.name}`, () => {
    test.use({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.isMobile });

    test('owner home and the token lab', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await setLang(page, 'he');
      for (const path of ['/dashboard', `${LAB}?density=default`]) {
        await page.goto(path);
        await page.locator('main').first().waitFor();
        await page.waitForLoadState('networkidle').catch(() => undefined);
        expect(await lowContrast(page), path).toEqual([]);
      }
    });
  });
}

test.describe('7 · the token lab shows the new roles', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the indicators row lists each dot with its ratio against the surface (W1-01 owns the full lab walk)', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    const row = page.getByTestId('lab-indicators');
    await expect(row.locator('li')).toHaveCount(5);
    for (const name of ['danger-dot', 'warn-dot + ring', 'gold-dot (ok)', 'neutral-dot', 'rule']) await expect(row).toContainText(name);
  });
});
