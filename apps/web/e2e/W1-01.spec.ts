import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { components } from '../lib/i18n/messages/components';
import { marketing } from '../lib/i18n/messages/marketing';
import { labEn, labHe } from '../app/dashboard/lab/tokens/copy';
import { OWNER_STATE } from './env';
import { ensurePasswordUser, loginViaMagicLink } from './helpers';

/**
 * W1-01 · design-system foundation v2 — the acceptance list in
 * docs/ux/IMPLEMENTATION-PLAN.md §W1-01, checked in a real browser:
 *  2. one focus indicator (2 px #1A5BC7, offset 2) on every Tab stop, never hidden under chrome;
 *  3. reduced motion: nothing animates except `.motion-essential`;
 *  4. <Money>: ₪ at the visual left in Hebrew, no `dir`;
 *  5. Toast v2 timings, pause, stack and live regions;
 *  6. Field v2 / MoneyInput / DateField;
 *  9. cookie consent: a region, first in focus order, Esc = essential only, inline in the app;
 * 10. /dashboard/lab/tokens for platform admins only, with visual baselines.
 */

const LAB = '/dashboard/lab/tokens';
const ds = { he: { ...components.he.ds, lab: labHe }, en: { ...components.en.ds, lab: labEn } };
const cookieLabel = { he: marketing.he.cookie.label, en: marketing.en.cookie.label };
const FOCUS_RGB = 'rgb(26, 91, 199)';
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

test.use({ storageState: OWNER_STATE });

async function setLang(page: Page, lang: 'he' | 'en', consent = true) {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: lang, url },
    ...(consent ? [{ name: 'rm_cookie_consent', value: 'necessary', url }] : []),
  ]);
  if (!consent) await page.context().clearCookies({ name: 'rm_cookie_consent' });
}

/** Relative luminance contrast of two `rgb(...)` strings. */
function contrast(a: string, b: string): number {
  const lum = (s: string) => {
    const [r, g, bl] = (s.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map((n) => {
      const c = Number(n) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolve once the page has stopped scrolling (two frames with the same scroll position). */
async function settleScroll(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = '';
        let still = 0;
        const started = performance.now();
        const tick = () => {
          const pos = `${scrollX},${scrollY}`;
          still = pos === last ? still + 1 : 0;
          last = pos;
          if (still >= 3 || performance.now() - started > 1500) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** The focused element's outline + the first opaque background behind it, plus how much of it is visible. */
async function focusProbe(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    let bg = 'rgb(255, 255, 255)';
    for (let n: HTMLElement | null = el.parentElement; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*, 0\)$/.test(c)) {
        bg = c;
        break;
      }
    }
    // Visible share: a 5×5 grid of points inside the box that hit the element itself.
    const r = el.getBoundingClientRect();
    let hit = 0;
    let total = 0;
    for (let i = 0; i < 5; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        const x = r.left + ((i + 0.5) / 5) * r.width;
        const y = r.top + ((j + 0.5) / 5) * r.height;
        total += 1;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const at = document.elementFromPoint(x, y);
        if (at && (at === el || el.contains(at) || at.contains(el))) hit += 1;
      }
    }
    return {
      tag: `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${(el.textContent ?? '').trim().slice(0, 30)}`,
      outlineColor: cs.outlineColor,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineOffset: cs.outlineOffset,
      bg,
      visible: r.width * r.height === 0 ? 1 : hit / total,
      zeroSize: r.width * r.height === 0,
    };
  });
}

test.describe('2 · focus indicator', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('20+ Tab stops across /dashboard, approvals and orders show the 2 px focus outline at ≥ 3:1', async ({ page }) => {
    await setLang(page, 'he');
    let checked = 0;
    for (const path of ['/dashboard', '/dashboard/approvals', '/dashboard/orders']) {
      await page.goto(path);
      await page.locator('main').first().waitFor();
      for (let i = 0; i < 9; i += 1) {
        await page.keyboard.press('Tab');
        const f = await focusProbe(page);
        if (!f || f.zeroSize) continue;
        expect.soft(f.outlineStyle, `${path} ${f.tag}`).toBe('solid');
        expect.soft(f.outlineWidth, `${path} ${f.tag}`).toBe('2px');
        expect.soft(f.outlineOffset, `${path} ${f.tag}`).toBe('2px');
        expect.soft(f.outlineColor, `${path} ${f.tag}`).toBe(FOCUS_RGB);
        expect.soft(contrast(f.outlineColor, f.bg), `${path} ${f.tag} on ${f.bg}`).toBeGreaterThanOrEqual(3);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(20);
  });
});

for (const vp of [
  { name: 'phone 390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'desktop 1440', viewport: { width: 1440, height: 900 } },
]) {
  test.describe(`2 · focus not obscured · ${vp.name}`, () => {
    test.use({ viewport: vp.viewport, isMobile: vp.isMobile ?? false, hasTouch: vp.hasTouch ?? false });

    test('with the consent banner shown, every focused element is ≥ 50 % visible', async ({ page }) => {
      await setLang(page, 'he', false);
      for (const path of ['/dashboard', '/dashboard/approvals']) {
        await page.goto(path);
        await expect(page.getByRole('region', { name: cookieLabel.he })).toBeVisible();
        for (let i = 0; i < 40; i += 1) {
          await page.keyboard.press('Tab');
          await settleScroll(page); // focus scrolling is smooth (scroll-behavior) — measure at rest
          const f = await focusProbe(page);
          if (!f || f.zeroSize) continue;
          expect.soft(f.visible, `${path} stop ${i + 1}: ${f.tag}`).toBeGreaterThanOrEqual(0.5);
        }
      }
    });
  });
}

test.describe('3 · reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('nothing animates on /, /dashboard or /showcase/receiver except .motion-essential', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setLang(page, 'he');
    for (const path of ['/', '/dashboard', '/showcase/receiver']) {
      await page.goto(path);
      await page.waitForTimeout(1200);
      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          .filter((a) => {
            const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
            return !target?.closest('.motion-essential');
          })
          .map((a) => {
            const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
            return `${(a as CSSAnimation).animationName ?? a.constructor.name} on ${target?.tagName ?? '?'}.${String(target?.className ?? '').slice(0, 60)}`;
          }),
      );
      expect(running, path).toEqual([]);
      // Script-driven motion (GSAP) shows up as inline transforms that keep changing.
      const snapshot = () =>
        page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[style*="transform"]')].map((el) => el.style.transform).join('|'),
        );
      const before = await snapshot();
      await page.waitForTimeout(400);
      expect(await snapshot(), `${path}: inline transforms changed`).toBe(before);
    }
  });
});

test.describe('lab page (platform admins)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('4 · <Money> puts ₪ at the visual left of the digits in Hebrew, with no dir attribute', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    const amounts = page.getByTestId('lab-money').locator('bdi.num');
    expect(await amounts.count()).toBeGreaterThanOrEqual(4);
    const report = await amounts.evaluateAll((els) =>
      els.map((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let glyph: DOMRect | null = null;
        let digit: DOMRect | null = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const s = n.textContent ?? '';
          for (let i = 0; i < s.length; i += 1) {
            const range = document.createRange();
            range.setStart(n, i);
            range.setEnd(n, i + 1);
            if (s[i] === '₪' && !glyph) glyph = range.getBoundingClientRect();
            if (/\d/.test(s[i]!) && !digit) digit = range.getBoundingClientRect();
          }
        }
        return {
          text: el.textContent,
          dir: el.getAttribute('dir'),
          font: getComputedStyle(el).fontFamily,
          numeric: getComputedStyle(el).fontVariantNumeric,
          ok: Boolean(glyph && digit && (glyph as DOMRect).right <= (digit as DOMRect).left + 0.5),
        };
      }),
    );
    for (const r of report) {
      expect(r.dir, r.text ?? '').toBeNull();
      expect(r.ok, `₪ left of the digits: ${r.text}`).toBe(true);
      expect(r.font).toMatch(/Heebo/);
      expect(r.numeric).toContain('tabular-nums');
    }
  });

  test('5 · Toast v2: action toast ≥ 10 s and pauses on hover; errors persist; ≤ 3 stack; live regions', async ({ page }) => {
    await page.clock.install();
    await setLang(page, 'he');
    await page.goto(LAB);
    const toasts = page.locator('[data-toast]');

    await page.getByRole('button', { name: ds.he.lab.showActionToast }).click();
    await expect(toasts).toHaveCount(1);
    await expect(page.locator('[data-live="polite"]')).toHaveText(ds.he.lab.toastUndo);
    await page.clock.fastForward(9000);
    await expect(toasts, 'an action toast is still up after 9 s').toHaveCount(1);
    await toasts.first().hover();
    await page.clock.fastForward(15000);
    await expect(toasts, 'paused while hovered').toHaveCount(1);
    await page.mouse.move(5, 5);
    await page.clock.fastForward(2000);
    await expect(toasts).toHaveCount(0);

    await page.getByRole('button', { name: ds.he.lab.showErrorToast }).click();
    await expect(page.locator('[data-live="assertive"]')).toHaveText(ds.he.lab.toastError);
    await page.clock.fastForward(60000);
    await expect(page.locator('[data-toast="error"]'), 'errors persist until dismissed').toHaveCount(1);
    await page.locator('[data-toast="error"]').getByRole('button', { name: components.he.toast.dismiss }).click();
    await expect(toasts).toHaveCount(0);

    for (let i = 0; i < 5; i += 1) await page.getByRole('button', { name: ds.he.lab.showToast }).click();
    await expect(toasts).toHaveCount(3);
    await page.clock.fastForward(5500);
    await expect(toasts, 'plain toasts leave after 5 s').toHaveCount(0);
  });

  test('5 · live regions are cleared on navigation (an old error is not left in role=alert)', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    await page.getByRole('button', { name: ds.he.lab.showErrorToast }).click();
    await expect(page.locator('[data-live="assertive"]')).toHaveText(ds.he.lab.toastError);
    await page.getByRole('link', { name: '/dashboard', exact: true }).click();
    await page.waitForURL(/\/dashboard$/);
    await expect(page.locator('[data-live="assertive"]')).toHaveText('');
    await expect(page.locator('[data-live="polite"]')).toHaveText('');
  });

  test('6 · Field v2 links hint and error; MoneyInput parses 7,5 and 1,250.50 and formats on blur', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    const name = page.getByLabel(ds.he.lab.nameLabel);
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    const describedBy = (await name.getAttribute('aria-describedby'))!;
    await expect(page.locator(`[id="${describedBy.split(' ').pop()}"]`)).toHaveText(ds.he.lab.nameError);
    const amountHint = (await page.getByLabel(ds.he.lab.amountLabel).getAttribute('aria-describedby'))!;
    expect(amountHint).toMatch(/-hint/);

    const money = page.getByTestId('lab-money-input');
    const values = page.getByTestId('lab-form-values');
    await money.fill('7,5');
    await money.blur();
    await expect(money).toHaveValue('7.50');
    await expect(values).toContainText('750 ·');
    await money.fill('1,250.50');
    await money.blur();
    await expect(money).toHaveValue('1,250.50');
    await expect(values).toContainText('125050 ·');
    await money.fill('abc');
    await money.blur();
    await expect(money).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(ds.he.moneyInput.invalid)).toBeVisible();
  });

  test('9 · keyboard: the segmented control is one Tab stop with arrow keys; the sheet traps and returns focus', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    const group = page.getByRole('radiogroup', { name: ds.he.lab.period }).first();
    await group.getByRole('radio', { name: ds.he.lab.month }).focus();
    await page.keyboard.press('ArrowLeft'); // RTL: left = next
    await expect(group.getByRole('radio', { name: ds.he.lab.quarter })).toHaveAttribute('aria-checked', 'true');
    await expect(group.getByRole('radio', { name: ds.he.lab.quarter })).toBeFocused();
    expect(await group.locator('[tabindex="0"]').count()).toBe(1);

    const opener = page.getByRole('button', { name: ds.he.lab.openSheet });
    await opener.click();
    const sheet = page.getByRole('dialog', { name: ds.he.lab.sheetTitle });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();

    await page.getByRole('button', { name: ds.he.lab.openConfirm }).click();
    const confirm = page.getByRole('alertdialog', { name: ds.he.lab.confirmTitle });
    await expect(confirm.locator('[data-confirm-stake]')).toContainText(ds.he.lab.supplier);
    await expect(confirm.locator('[data-confirm-stake]')).toContainText('1,240.00');
    await expect(confirm.getByRole('button', { name: ds.he.lab.keep })).toBeFocused();
    await page.keyboard.press('Escape');
  });

  test('DoD-2 · axe (wcag22aa + best-practice): no critical or serious issue on the lab page, he and en', async ({ page }) => {
    for (const lang of ['he', 'en'] as const) {
      await setLang(page, lang);
      await page.goto(LAB);
      await page.addScriptTag({ content: AXE_SOURCE });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
        const res = await axe.run(document.querySelector('[data-lab="tokens"]'), {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        });
        return res.violations
          .filter((v) => v.impact === 'critical' || v.impact === 'serious')
          .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
      });
      expect(violations, lang).toEqual([]);
    }
  });

  test('10 · the lab renders every section in he and en and matches its visual baseline', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const lang of ['he', 'en'] as const) {
      await setLang(page, lang);
      for (const vp of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        if (lang === 'en' && vp.width === 390) continue;
        await page.setViewportSize(vp);
        await page.goto(`${LAB}?density=default`);
        await expect(page.getByRole('heading', { level: 1, name: ds[lang].lab.title })).toBeVisible();
        for (const key of ['colors', 'families', 'moneyStates', 'type', 'numeric', 'actions', 'forms', 'feedback', 'overlays'] as const) {
          await expect(page.getByRole('heading', { level: 2, name: ds[lang].lab[key] })).toBeVisible();
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(0);
        await expect(page.locator('[data-lab="tokens"]')).toHaveScreenshot(`lab-tokens-${lang}-${vp.width}.png`, {
          animations: 'disabled',
          mask: [page.locator('.motion-essential')],
          maxDiffPixelRatio: 0.03,
        });
      }
    }
    for (const density of ['compact', 'touch'] as const) {
      await setLang(page, 'he');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${LAB}?density=${density}`);
      await expect(page.locator(`[data-lab="tokens"][data-density="${density}"]`)).toBeVisible();
    }
  });
});

test.describe('6 · DateField reads dd.mm.yyyy in Hebrew on an en-US browser', () => {
  test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

  test('typed and picked dates', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(LAB);
    const date = page.getByTestId('lab-date');
    await expect(date).toHaveValue('25.10.2026');
    await date.fill('1/2/26');
    await date.blur();
    await expect(date).toHaveValue('01.02.2026');
    await expect(page.getByTestId('lab-form-values')).toContainText('2026-02-01');
    await page.getByRole('button', { name: ds.he.dateField.open }).click();
    const calendar = page.getByRole('grid');
    await expect(calendar.getByRole('columnheader').first()).toHaveText('א׳');
    await page.keyboard.press('ArrowLeft'); // RTL: left = the next day
    await page.keyboard.press('Enter');
    await expect(date).toHaveValue('02.02.2026');
  });
});

test.describe('9 · cookie consent', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a region, first in the focus order, inline inside the app; Esc = essential only', async ({ page }) => {
    await setLang(page, 'he', false);
    await page.goto('/dashboard');
    const region = page.getByRole('region', { name: cookieLabel.he });
    await expect(region).toBeVisible();
    await expect(page.getByRole('dialog', { name: cookieLabel.he })).toHaveCount(0);
    expect(await region.getAttribute('aria-live')).toBeNull();
    expect(await region.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    // First in the DOM → the first Tab stop lands inside it.
    await page.keyboard.press('Tab');
    expect(await region.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(region).toHaveCount(0);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'rm_cookie_consent')?.value).toBe('necessary');
  });

  test('inline on /login, floating card on the landing', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/login');
    const region = page.getByRole('region', { name: cookieLabel.he });
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute('data-consent', 'inline');
    await page.goto('/');
    await expect(page.locator('[data-consent="floating"]')).toHaveCount(1);
  });
});

test.describe('10 · lab page is hidden from everyone but platform admins', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a manager gets a 404', async ({ page }) => {
    const email = 'e2e-w101-manager@restomatch.test';
    await ensurePasswordUser({ email, password: 'E2e-W101-Manager-9!' });
    await loginViaMagicLink(page, email, '/dashboard');
    const res = await page.goto(LAB);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: ds.he.lab.title })).toHaveCount(0);
  });
});
