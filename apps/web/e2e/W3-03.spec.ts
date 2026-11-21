import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

/**
 * W3-03b · the app-wide PWA, without the receiving pages (released later):
 * the manifest (scope /dashboard/, four shortcuts, POST share target), the
 * share page (never a 404; text → order capture; empty share → calm card), the
 * server fallback for the share POST, and /dashboard/settings/notifications
 * (receiver: field events only, no ₪, 56 px controls; storage not deployed yet →
 * an honest "coming soon"). Receiver on a phone, Hebrew. Axe wcag22aa clean.
 */
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const RECEIVER = 'receiver@kfar-hazeitim.test';
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

let cookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(RECEIVER);
  await page.locator('#password').fill(process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!');
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  cookies = await ctx.cookies();
  await ctx.close();
});

test.beforeEach(async ({ page }) => {
  const url = test.info().project.use.baseURL!;
  await page.context().addCookies([
    { name: 'rm_locale', value: 'he', url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  await page.context().addCookies(cookies);
});

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
    );
    return res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

test('the manifest is app-wide with a POST share target', async ({ request }) => {
  const res = await request.get('/pwa/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.scope).toBe('/dashboard/');
  expect(m.start_url).toBe('/dashboard?source=pwa');
  expect(m.shortcuts).toHaveLength(4);
  expect(m.share_target).toMatchObject({ action: '/dashboard/share/receive', method: 'POST' });
});

test('an empty or expired share is a calm card, never a 404', async ({ page }) => {
  const res = await page.goto('/dashboard/share?id=000000000000000000000000');
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId('share-page')).toHaveAttribute('data-route', 'empty');
  await expect(page.getByRole('link', { name: 'למסך הבית' })).toBeVisible();
  expect(await page.locator('main').innerText()).not.toContain('₪');
  expect(await axeSerious(page)).toEqual([]);
});

test('shared text without a worker reaches the order capture flow (server fallback)', async ({ page }) => {
  // The share sheet's POST, as the server sees it when no worker answers.
  const res = await page.request.post('/dashboard/share/receive', { multipart: { text: 'עגבניות 5 ק״ג' }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  const to = new URL(res.headers().location!, 'http://x');
  expect(to.pathname).toBe('/dashboard/share');
  expect(to.searchParams.get('text')).toBe('עגבניות 5 ק״ג');
  await page.goto(`${to.pathname}${to.search}`);
  // Order capture on → it opens there (the receiver gets the forward card); off → the share page keeps the text.
  await expect(page.locator('[data-testid="share-forward"], [data-testid="share-page"][data-route="orderText"]').first()).toBeVisible();
  await expect(page.getByText('עגבניות 5 ק״ג').first()).toBeVisible();
});

test('notification settings: field events only for the receiver, honest about storage', async ({ page }) => {
  const res = await page.goto('/dashboard/settings/notifications');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'התראות' })).toBeVisible();
  await expect(page.getByTestId('push-unavailable')).toBeVisible();
  await expect(page.getByText('משלוחים היום (06:00)')).toBeVisible();
  await expect(page.getByText('חשבוניות שמחכות לאישור')).toHaveCount(0);
  const enable = page.getByRole('button', { name: 'הפעלת התראות בטלפון הזה' });
  await expect(enable).toBeVisible();
  expect((await enable.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  expect(await page.locator('main').innerText()).not.toContain('₪');
  expect(await axeSerious(page)).toEqual([]);
});
