import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { OWNER_STATE } from './env';
import { collectPageErrors, loginViaMagicLink } from './helpers';

/**
 * W2-14 · admin trust: visible rules, guarded roles, honest export.
 *   - Settings: one h1; "הכללים שבתוקף" shows each approval rule with ₪ and a
 *     default/custom chip; ₪ left of the digit in he.
 *   - Team: the role select only STAGES a change (row bar + Cancel); promoting
 *     to owner opens a ConfirmDialog; the caller's own row is locked.
 *   - Exports: the summary says what the file will contain before download; no
 *     gold button.
 *   - Integrations: the bookkeeper edits account cards (owner decision §7).
 *   - axe (WCAG 2.2 AA): 0 critical/serious, he + en.
 * The lab seed is dated 2026-10-25, so the browser clock is pinned to it.
 * W2_14_SHOTS=1 writes the DoD screens to e2e/__screenshots__/W2-14/.
 */
test.use({ storageState: OWNER_STATE });

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SHOTS = process.env.W2_14_SHOTS ? 'e2e/__screenshots__/W2-14' : null;
const SEED_NOW = new Date('2026-10-25T09:40:00Z');

async function prepare(page: Page, locale: 'he' | 'en', width: number) {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.clock.setFixedTime(SEED_NOW);
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // caret: 'initial' — the default 'hide' leaves an inline caret-color on inputs
  // that the next navigation's hydration check reports as a mismatch.
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, caret: 'initial' });
}

/** In he-IL the ₪ glyph renders to the LEFT of the first digit (DoD-4). */
async function shekelIsLeftOfDigits(el: Locator): Promise<boolean> {
  return el.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      const s = text.indexOf('₪');
      const d = text.search(/\d/);
      if (s < 0 || d < 0) continue;
      const rect = (i: number) => {
        const r = document.createRange();
        r.setStart(node!, i);
        r.setEnd(node!, i + 1);
        return r.getBoundingClientRect();
      };
      return rect(s).right <= rect(d).left + 0.5;
    }
    return false;
  });
}

async function seriousAxe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    const w = window as unknown as {
      axe: {
        run: (c: unknown, o: unknown) => Promise<{
          violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
        }>;
      };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['[data-worker-status]']] },
      { runOnly: { type: 'tag', values: tags } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  }, WCAG_AA);
}

test('settings: one h1, the approval rules in force with ₪ and a default/custom chip', async ({ page }) => {
  const errors = collectPageErrors(page);
  await prepare(page, 'he', 1440);
  await page.goto('/dashboard/settings');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('הגדרות');
  const rules = page.getByTestId('rules-in-force');
  await expect(rules).toBeVisible();
  const noPo = rules.locator('li', { hasText: 'חשבונית בלי הזמנה מעל' });
  await expect(noPo).toContainText('₪');
  await expect(noPo.getByText(/ברירת מחדל|הותאם/)).toBeVisible();
  expect(await shekelIsLeftOfDigits(noPo)).toBe(true);
  await expect(rules.locator('li', { hasText: 'פריט שלא הוזמן' })).toContainText('₪');
  // No number inputs remain for ₪ rules on this route's new sections.
  await expect(rules.locator('input[type=number]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'טלפון נייד' })).toBeVisible();
  // The rule inputs are text + decimal (no type=number), accept "7,5", and a
  // change raises the dirty bar; Discard restores. VAT is read-only + "שנו…".
  await expect(page.locator('input[type=number]')).toHaveCount(0);
  const pricePct = page.locator('#set-pricePercent');
  await expect(pricePct).toHaveAttribute('inputmode', 'decimal');
  await pricePct.fill('7,5');
  const dirtyBar = page.getByTestId('settings-dirty-bar');
  await expect(dirtyBar).toContainText('יש שינויים שלא נשמרו');
  await pricePct.fill('170');
  await expect(page.getByText('אחוז בין 0 ל-100')).toBeVisible();
  await dirtyBar.getByRole('button', { name: 'בטלו' }).click();
  await expect(dirtyBar).toHaveCount(0);
  await expect(page.getByTestId('vat-readonly')).toContainText('%');
  await expect(page.locator('#prof-tz')).toHaveJSProperty('tagName', 'SELECT');
  await shot(page, 'settings-he-1440');
  expect(await seriousAxe(page)).toEqual([]);

  await prepare(page, 'he', 390);
  await page.goto('/dashboard/settings');
  await expect(page.getByTestId('rules-in-force')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, 'settings-he-390');

  await prepare(page, 'en', 1440);
  await page.goto('/dashboard/settings');
  await expect(page.locator('h1')).toHaveText('Settings');
  await expect(page.getByTestId('rules-in-force')).toContainText('An invoice without an order above');
  await shot(page, 'settings-en-1440');
  expect(await seriousAxe(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('team: a role change is staged, Cancel reverts, owner promotion confirms, own row locked', async ({ page }) => {
  const errors = collectPageErrors(page);
  await prepare(page, 'he', 1440);
  await page.goto('/dashboard/team');
  await expect(page.locator('h1')).toHaveCount(1);

  const managerRole = page.getByRole('combobox', { name: 'תפקיד עבור manager@kfar-hazeitim.test' });
  await managerRole.selectOption('bookkeeper');
  const staged = page.getByRole('group', { name: 'שינוי תפקיד ממתין עבור manager@kfar-hazeitim.test' });
  await expect(staged).toBeVisible();
  await expect(staged).toContainText('←');
  await staged.getByRole('button', { name: 'בטלו' }).click();
  await expect(staged).toHaveCount(0);
  await expect(managerRole).toHaveValue('manager');

  // Promoting to owner is a guarded transition: Save opens a ConfirmDialog.
  await managerRole.selectOption('owner');
  await page
    .getByRole('group', { name: 'שינוי תפקיד ממתין עבור manager@kfar-hazeitim.test' })
    .getByRole('button', { name: 'שמרו' })
    .click();
  // A promotion to owner is a danger confirm: ConfirmDialog renders an alertdialog.
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('בעלים');
  await shot(page, 'team-confirm-he-1440');
  expect(await seriousAxe(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'בטלו' }).click();
  await expect(dialog).toBeHidden();
  await expect(managerRole).toHaveValue('owner'); // still only staged, nothing saved

  await expect(page.getByTestId('transfer-ownership')).toBeVisible();
  // The caller's own row cannot change its own role.
  await expect(page.getByRole('combobox', { name: 'תפקיד עבור owner@kfar-hazeitim.test' })).toBeDisabled();

  await prepare(page, 'he', 390);
  await page.goto('/dashboard/team');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, 'team-he-390');
  await prepare(page, 'en', 1440);
  await page.goto('/dashboard/team');
  await shot(page, 'team-en-1440');
  expect(await seriousAxe(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('exports: the summary says what the file will contain; one primary, no gold', async ({ page }) => {
  const errors = collectPageErrors(page);
  await prepare(page, 'he', 1440);
  await page.goto('/dashboard/exports');
  const summary = page.getByTestId('export-summary');
  await expect(summary).toContainText(/חשבוניות|אין חשבוניות/);
  const firstMoney = summary.locator('bdi').first();
  if (await firstMoney.count()) {
    expect(await shekelIsLeftOfDigits(firstMoney)).toBe(true);
  }
  await expect(page.getByText('כולל חשבוניות עם פער פתוח')).toBeVisible();
  await expect(page.locator("button.bg-gold-bold")).toHaveCount(0);
  await shot(page, 'exports-he-1440');
  expect(await seriousAxe(page)).toEqual([]);

  await prepare(page, 'he', 390);
  await page.goto('/dashboard/exports');
  await expect(page.getByTestId('export-summary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await shot(page, 'exports-he-390');
  await prepare(page, 'en', 1440);
  await page.goto('/dashboard/exports');
  await expect(page.getByTestId('export-summary')).toContainText(/invoices/);
  await shot(page, 'exports-en-1440');
  expect(await seriousAxe(page)).toEqual([]);
  // The browser clock is pinned to the seed date while the dev server runs on the
  // real date, so the date inputs' default range hydrates differently. That is
  // the pin, not the page: ignore only the hydration-mismatch report.
  expect(errors.filter((e) => !e.includes('hydration-mismatch'))).toEqual([]);
});

test.describe('bookkeeper', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('edits account cards (owner decision §7) and never sees an invented S… code', async ({ page }) => {
    await prepare(page, 'he', 1440);
    await loginViaMagicLink(page, 'bookkeeper@kfar-hazeitim.test', '/dashboard/integrations');
    const res = await page.goto('/dashboard/integrations');
    test.skip(res?.status() === 404, 'the integrations flag is off on this seed');
    const card = page.locator('#acc-expenseAccount');
    await expect(card).toBeEnabled();
    await expect(page.getByText('רק הבעלים והנהלת החשבונות')).toHaveCount(0);
    const placeholders = await page.locator('input[id^="acc-sup-"]').evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).placeholder),
    );
    expect(placeholders.some((p) => /^S[0-9A-F]{8}$/.test(p))).toBe(false);
    await shot(page, 'integrations-bookkeeper-he-1440');
    expect(await seriousAxe(page)).toEqual([]);
  });
});
