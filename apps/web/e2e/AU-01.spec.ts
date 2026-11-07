import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { he } from '../lib/i18n/messages/automations/he';
import { en } from '../lib/i18n/messages/automations/en';

/**
 * AU-01 · /dashboard/settings/automations on the seeded demo tenant
 * (features.all → every flag row is on).
 *   - owner: one row per automation, a switch with a confirm naming who gets it;
 *     price alerts off → on round-trips; the receiver-brief row shows no ₪;
 *   - manager: the list, no switch;
 *   - receiver: the calm forbidden card, never the list;
 *   - he 390 / 1440 and en 1440 render without horizontal scroll; axe clean.
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const PATH = '/dashboard/settings/automations';
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function signIn(context: BrowserContext, page: Page, role: string, locale: 'he' | 'en' = 'he') {
  const base = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: base },
    { name: 'rm_locale', value: locale, url: base },
  ]);
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: {
      email: `${role}@kfar-hazeitim.test`,
      password: PASSWORD,
      rememberMe: 'false',
      csrfToken: csrf.csrfToken,
      callbackUrl: '/dashboard',
    },
    maxRedirects: 0,
  });
  expect(res.status(), `password sign-in for ${role}`).toBeLessThan(400);
}

async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['[data-testid=worker-status]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('AU-01 automations page', () => {
  test('owner: rows, confirm, toggle off and on again; receiver brief has no ₪', async ({ context, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(context, page, 'owner');
    await page.goto(PATH);
    await expect(page.getByRole('heading', { name: he.page.title })).toBeVisible();
    for (const key of ['priceAlerts', 'recovery', 'monthlyReport', 'eveningDigest', 'receiverBrief', 'matchAlerts']) {
      await expect(page.locator(`[data-automation=${key}]`)).toBeVisible();
    }
    const brief = page.locator('[data-automation=receiverBrief]');
    await expect(brief).toContainText(he.row.noIls);
    expect(await brief.innerText()).not.toMatch(/₪/);

    const row = page.locator('[data-automation=priceAlerts]');
    const sw = row.getByRole('switch');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(he.items.priceAlerts.name);
    await dialog.getByRole('button', { name: he.confirm.off }).click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(page.getByRole('dialog')).toContainText(he.items.priceAlerts.when);
    await page.getByRole('dialog').getByRole('button', { name: he.confirm.on }).click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');

    expect(await axe(page)).toEqual([]);
    await noHorizontalScroll(page);
  });

  test('owner he 390 and en 1440 render, axe clean', async ({ context, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(context, page, 'owner');
    await page.goto(PATH);
    await expect(page.getByRole('heading', { name: he.page.title })).toBeVisible();
    await noHorizontalScroll(page);
    expect(await axe(page)).toEqual([]);

    await context.addCookies([{ name: 'rm_locale', value: 'en', url: test.info().project.use.baseURL! }]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PATH);
    await expect(page.getByRole('heading', { name: en.page.title })).toBeVisible();
    await noHorizontalScroll(page);
    expect(await axe(page)).toEqual([]);
  });

  test('manager sees the list without a switch', async ({ context, page }) => {
    await signIn(context, page, 'manager');
    await page.goto(PATH);
    await expect(page.locator('[data-automation=priceAlerts]')).toBeVisible();
    await expect(page.getByText(he.page.readOnly)).toBeVisible();
    await expect(page.getByRole('switch')).toHaveCount(0);
  });

  test('receiver gets the forbidden card, never the list', async ({ context, page }) => {
    await signIn(context, page, 'receiver');
    await page.goto(PATH);
    await expect(page.getByText(he.page.forbiddenTitle)).toBeVisible();
    await expect(page.locator('[data-automation]')).toHaveCount(0);
  });
});
