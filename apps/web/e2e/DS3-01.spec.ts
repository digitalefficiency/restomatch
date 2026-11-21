import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { kitEn, kitHe } from '../app/dashboard/lab/kit/_copy';
import { OWNER_STATE } from './env';
import { ensurePasswordUser, loginViaMagicLink } from './helpers';

/**
 * DS3-01 · shared components in the clean finish, on the kit page (/dashboard/lab/kit).
 * docs/ux/ds3/WORKPLAN.md, DS3-01 acceptance: every kit component live, in regular and compact,
 * passing the a11y check in both densities; the money markup keeps ₪ at the visual left in Hebrew;
 * the undo toast shows its time; controls keep their limits; platform admins only.
 */

const KIT = '/dashboard/lab/kit';
const COPY = { he: kitHe, en: kitEn };
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const CARDS = Object.keys(kitHe.cards);

test.use({ storageState: OWNER_STATE });

async function setLang(page: Page, lang: 'he' | 'en') {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: lang, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (n: Element | null, o: object) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const res = await axe.run(document.querySelector('[data-kit]'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    });
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
  });
}

test.describe('DS3-01 kit page (platform admins)', () => {
  for (const lang of ['he', 'en'] as const) {
    test(`renders every card, no page errors, no sideways scroll (${lang}, 1440 and 390)`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await setLang(page, lang);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        await page.goto(KIT);
        await expect(page.getByRole('heading', { level: 1, name: COPY[lang].title })).toBeVisible();
        for (const card of CARDS) {
          await expect(page.getByRole('heading', { level: 2, name: COPY[lang].cards[card as keyof typeof kitHe.cards] })).toBeVisible();
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `sideways scroll at ${width}`).toBeLessThanOrEqual(0);
      }
      expect(errors).toEqual([]);
    });
  }

  test('a11y: no critical or serious axe finding, regular and compact, he and en', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const lang of ['he', 'en'] as const) {
      await setLang(page, lang);
      for (const density of ['regular', 'compact'] as const) {
        await page.goto(density === 'compact' ? `${KIT}?density=compact` : KIT);
        await expect(page.locator('[data-kit-density]')).toHaveAttribute('data-kit-density', density);
        expect(await axeViolations(page), `${lang} · ${density}`).toEqual([]);
      }
    }
  });

  test('the density switch acts at once, is shareable, and tightens the table', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(KIT);
    const row = page.locator('#kit-table tbody tr').first();
    const regular = (await row.boundingBox())!.height;
    await page.getByRole('radio', { name: kitHe.densityCompact }).click();
    await expect(page.locator('[data-kit-density]')).toHaveAttribute('data-kit-density', 'compact');
    await expect(page).toHaveURL(/density=compact/);
    await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(regular);
  });

  test('money: ₪ sits left of the digits in Hebrew, quiet and smaller; the text is formatIls() whole', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(KIT);
    const checks = await page.locator('#kit-money bdi:has([data-money="cur"])').evaluateAll((els) =>
      els.map((el) => {
        const cur = el.querySelector('[data-money="cur"]')!.getBoundingClientRect();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let digit: DOMRect | null = null;
        for (let n = walker.nextNode() as Text | null; n && !digit; n = walker.nextNode() as Text | null) {
          const i = n.data.search(/\d/);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          digit = r.getBoundingClientRect();
        }
        const curSize = parseFloat(getComputedStyle(el.querySelector('[data-money="cur"]')!).fontSize);
        const figSize = parseFloat(getComputedStyle(el).fontSize);
        return { text: el.textContent ?? '', left: digit ? cur.right <= digit.left + 0.5 : false, smaller: curSize < figSize, floor: curSize >= 12 };
      }),
    );
    expect(checks.length).toBeGreaterThan(3);
    for (const c of checks) {
      expect(c.left, `₪ left of digits in "${c.text}"`).toBe(true);
      expect(c.smaller, `smaller ₪ in "${c.text}"`).toBe(true);
      expect(c.floor, `₪ at least 12 px in "${c.text}"`).toBe(true);
    }
  });

  test('status: one solid pill with a white word; pending is grey with a clock, never a warning', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(KIT);
    const solid = page.locator('#kit-status [data-pill="solid"]').first();
    const colours = await solid.evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
    expect(colours.fg).toBe('rgb(255, 255, 255)');
    const pending = page.locator('#kit-status [data-pill="neutral"]', { hasText: kitHe.demo.awaitingLink });
    await expect(pending.locator('svg')).toHaveCount(1);
    const pendingBg = await pending.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(pendingBg).not.toBe(colours.bg);
  });

  test('the undo toast: action, a timer line that shortens, paused under the pointer', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(KIT);
    await page.getByRole('button', { name: kitHe.demo.showToast }).click();
    const toast = page.locator('[data-toast]').filter({ hasText: kitHe.demo.toastText });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: kitHe.demo.cancel })).toBeVisible();
    const line = toast.locator('[data-toast-timer]');
    await expect(line).toBeVisible();
    const scale = () => line.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    const a = await scale();
    await page.waitForTimeout(600);
    const b = await scale();
    expect(b).toBeLessThan(a);
    await toast.hover();
    const c = await scale();
    await page.waitForTimeout(600);
    expect(Math.abs((await scale()) - c)).toBeLessThan(0.02);
    await toast.getByRole('button', { name: kitHe.demo.cancel }).click();
    await expect(page.locator('[data-toast]').filter({ hasText: kitHe.demo.toastUndone })).toBeVisible();
  });

  test('controls: the switch row toggles, the number field keeps its limits, the tooltip shows on focus and Esc hides it', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(KIT);
    const sw = page.getByRole('switch', { name: kitHe.demo.switchLabel });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.locator('#kit-controls [data-switch]').getByText(kitHe.demo.switchHint).click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    const field = page.locator('#kit-controls [data-number-field] input');
    await field.fill('25');
    await field.blur();
    await expect(field).toHaveValue('20');
    await expect(page.locator('#kit-controls [data-number-field]').getByRole('button').last()).toBeDisabled();

    const trigger = page.locator('#kit-controls [data-tooltip] button');
    await trigger.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const tip = page.locator('#kit-controls [data-tooltip-box]');
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
  });

  test('the three-way strip: one summary for assistive tech, the off cell tinted', async ({ page }) => {
    await setLang(page, 'he');
    await page.goto(KIT);
    const strip = page.locator('#kit-match [data-match-strip]').first();
    await expect(strip).toHaveAttribute('aria-label', /הוזמן 9\.5, התקבל 6\.5, חויב 9\.5/);
    const off = strip.locator('[data-cell="received"]');
    const bg = await off.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('DS3-01 kit page is hidden from everyone but platform admins', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a manager gets a 404', async ({ page }) => {
    const email = 'e2e-ds301-manager@restomatch.test';
    await ensurePasswordUser({ email, password: 'E2e-DS301-Manager-9!' });
    await loginViaMagicLink(page, email, '/dashboard');
    const res = await page.goto(KIT);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: kitHe.title })).toHaveCount(0);
  });
});
