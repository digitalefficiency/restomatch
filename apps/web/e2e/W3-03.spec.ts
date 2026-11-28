import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

/**
 * W3-03b · the app-wide PWA, without the receiving pages (released later):
 * the manifest (scope /dashboard, start_url a 200 inside it, no shortcuts, POST share target), the
 * share page (never a 404; text → order capture; empty share → calm card), the
 * server fallback for the share POST, and /dashboard/settings/notifications
 * (receiver: field events only, no ₪, 56 px controls; storage not deployed yet →
 * an honest "coming soon"), and the installed launch (controlled online, the
 * offline page offline). Receiver on a phone, Hebrew. Axe wcag22aa clean.
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

test('the manifest is app-wide with a POST share target and no per-device shortcuts', async ({ page, request }) => {
  const res = await request.get('/pwa/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.scope).toBe('/dashboard');
  expect(m.share_target).toMatchObject({ action: '/dashboard/share/receive', method: 'POST' });
  expect(m.shortcuts).toBeUndefined();
  // The launch: start_url answers 200 itself (no 308 out of scope), on a path inside the scope.
  const launch = await page.request.get(m.start_url, { maxRedirects: 0 });
  expect(launch.status()).toBe(200);
  expect(new URL(launch.url()).pathname.startsWith(m.scope)).toBe(true);
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

test('the installed app launches controlled, and offline its launch page is the offline page', async ({ page, context }) => {
  test.setTimeout(120_000);
  // The app-wide registration, as AppPwa makes it (the receiverPwa flag is off for this tenant).
  await page.goto('/dashboard/settings/notifications');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/receiver-sw.js', { scope: '/dashboard' });
    await navigator.serviceWorker.ready;
  });
  // The launch page itself is in the registration's scope: it gets a controller.
  await page.goto('/dashboard?source=pwa');
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), { timeout: 30_000 })
    .toContain('/receiver-sw.js');
  // No signal: the launch shows the offline page, never the browser's error; its one
  // action retries the launch (every role can open it, not every role can open receiving).
  await context.setOffline(true);
  try {
    await page.goto('/dashboard?source=pwa');
    await expect(page.getByRole('heading', { name: 'אין חיבור לאינטרנט' })).toBeVisible();
    await expect(page.locator('a.retry')).toHaveAttribute('href', '/dashboard?source=pwa');
  } finally {
    await context.setOffline(false);
  }
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  });
});

test("a receiver's cold offline start reaches the receiving board's snapshot from the launch page", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto('/dashboard/settings/notifications');
  // Both registrations, as AppPwa + ReceiverPwa make them, and the board's snapshot as the receiving shell keeps it.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/receiver-sw.js', { scope: '/dashboard' });
    await navigator.serviceWorker.register('/receiver-sw.js', { scope: '/dashboard/receiving' });
    await navigator.serviceWorker.ready;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs.map(
        (r) =>
          new Promise<void>((done) => {
            const sw = r.installing ?? r.waiting ?? r.active;
            if (!sw || sw.state === 'activated') return done();
            sw.addEventListener('statechange', () => sw.state === 'activated' && done());
          }),
      ),
    );
    const snap = await caches.open('rm-receiver-snapshot-v1');
    await snap.put('/dashboard/receiving', new Response('<!doctype html><title>board</title><meta charset="utf-8"><h1>לוח הקבלה (שמור)</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  });
  await context.setOffline(true);
  try {
    await page.goto('/dashboard?source=pwa');
    await expect(page.getByRole('heading', { name: 'אין חיבור לאינטרנט' })).toBeVisible();
    const retry = page.locator('a.retry');
    await expect(retry).toHaveAttribute('href', '/dashboard/receiving?source=pwa');
    await retry.click();
    await expect(page.getByRole('heading', { name: 'לוח הקבלה (שמור)' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
  await page.evaluate(async () => {
    await caches.delete('rm-receiver-snapshot-v1');
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  });
});
