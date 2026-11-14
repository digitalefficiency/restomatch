import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { he as askHe } from '../lib/i18n/messages/ask/he';
import { en as askEn } from '../lib/i18n/messages/ask/en';
import { OWNER_STATE } from './env';
import { collectPageErrors, loginViaMagicLink } from './helpers';

/**
 * AU-06 · Ask answers "what needs me", offline (no key in e2e), on the seeded demo tenant:
 *  - the five new chips sit after the five leak chips and each answers with a sentence;
 *  - "who owes me" cites the credit tracker and its link navigates;
 *  - unknown figures are sentences, never ₪0 (interims until G-12a / AU-02 / W2-03);
 *  - the manager and the bookkeeper (owner I3) open Ask; receiver and chef do not;
 *  - axe he + en; Tab walks the chips; DoD screenshots he 390/1440, en 1440.
 */
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const NEW_CHIPS = ['waitingForMe', 'intakeStuck', 'whoOwesMe', 'toPayThisWeek', 'vatAtRisk'] as const;
const SHOTS = 'e2e/__screenshots__/AU-06';

async function axeSerious(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`);
  });
}

async function asRole(browser: Browser, email: string, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL }]);
  const page = await context.newPage();
  await loginViaMagicLink(page, email);
  return { context, page };
}

async function askChip(page: Page, key: (typeof NEW_CHIPS)[number]) {
  const before = await page.getByTestId('ask-answer').count();
  await page.getByTestId(`ask-suggestion-${key}`).click();
  await expect(page.getByTestId('ask-answer')).toHaveCount(before + 1);
  const answer = page.getByTestId('ask-answer').last();
  // Wait for the final answer, not the "checking your data…" placeholder.
  await expect(answer).not.toContainText(askHe.thinking);
  await expect(answer).not.toContainText(askEn.thinking);
  return answer;
}

test.describe('owner', () => {
  test.use({ storageState: OWNER_STATE, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => {
    await page.clock.setSystemTime(new Date('2026-10-25T09:40:00Z'));
  });

  test('the five new chips follow the five leak chips, in order, and each answers in Hebrew', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/dashboard/ask');
    const ids = await page.locator('[data-testid^="ask-suggestion-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(ids.slice(5)).toEqual(NEW_CHIPS.map((k) => `ask-suggestion-${k}`));
    for (const k of NEW_CHIPS) await expect(page.getByTestId(`ask-suggestion-${k}`)).toHaveText(askHe.suggestions[k]);

    for (const k of NEW_CHIPS) {
      const answer = await askChip(page, k);
      const text = await answer.innerText();
      expect(text, k).not.toMatch(/₪\s?0(\.00)?(?!\d)/); // unknown is never ₪0
      expect(text, k).not.toMatch(/תביע|דריש|מחלוקת/); // partner wording
    }
    await page.screenshot({ path: `${SHOTS}/ask-he-1440.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

  test('who owes me cites the credit tracker and the link navigates', async ({ page }) => {
    await page.goto('/dashboard/ask');
    const answer = await askChip(page, 'whoOwesMe');
    const link = answer.locator('a[href="/dashboard/recovery"]');
    await expect(link).toBeVisible();
    // ₪ comes from formatIls() (2 dp, with its bidi marks), never a hand-built string.
    const t = await answer.innerText();
    expect(t).toMatch(/[\d,]+\.\d{2}[\s\u200f\u00a0]*₪/);
    await link.click();
    await page.waitForURL(/\/dashboard\/recovery/);
    await expect(page.getByText('404', { exact: true })).toHaveCount(0);
  });

  test('axe he + en; Tab walks the chips', async ({ page }) => {
    await page.goto('/dashboard/ask');
    expect(await axeSerious(page)).toEqual([]);
    await page.getByTestId('ask-suggestion-leakChange').focus();
    for (let i = 0; i < 9; i += 1) await page.keyboard.press('Tab');
    await expect(page.getByTestId('ask-suggestion-vatAtRisk')).toBeFocused();

    await page.context().addCookies([{ name: 'rm_locale', value: 'en', url: new URL(page.url()).origin }]);
    await page.goto('/dashboard/ask');
    await expect(page.getByTestId('ask-suggestion-whoOwesMe')).toHaveText(askEn.suggestions.whoOwesMe);
    expect(await axeSerious(page)).toEqual([]);
    await askChip(page, 'whoOwesMe');
    await page.screenshot({ path: `${SHOTS}/ask-en-1440.png`, fullPage: true });
    await page.context().addCookies([{ name: 'rm_locale', value: 'he', url: new URL(page.url()).origin }]);
  });

  test('phone 390: chips wrap, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard/ask');
    await askChip(page, 'vatAtRisk');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/ask-he-390.png`, fullPage: true });
  });
});

test.describe('other roles', () => {
  test('manager and bookkeeper open Ask and get the same answer', async ({ browser, baseURL }) => {
    for (const email of ['manager@kfar-hazeitim.test', 'bookkeeper@kfar-hazeitim.test']) {
      const { context, page } = await asRole(browser, email, baseURL!);
      await page.goto('/dashboard/ask');
      await expect(page.getByTestId('ask-page'), email).toBeVisible();
      const answer = await askChip(page, 'whoOwesMe');
      await expect(answer.locator('a[href="/dashboard/recovery"]'), email).toBeVisible();
      await context.close();
    }
  });

  test('receiver and chef never reach Ask', async ({ browser, baseURL }) => {
    for (const email of ['receiver@kfar-hazeitim.test', 'chef@kfar-hazeitim.test']) {
      const { context, page } = await asRole(browser, email, baseURL!);
      await page.goto('/dashboard/ask');
      await expect(page.getByTestId('ask-page'), email).toHaveCount(0);
      await context.close();
    }
  });
});
