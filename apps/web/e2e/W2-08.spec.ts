import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W2-08 · The task spine: "מחכה לך" on every home, nav badges, the bell and the
 * cross-branch 404 — all from one `tasks.mine` source (lab, DEMO_TODAY 25.10).
 *
 *  - Owner: the decision row, the approvals badge and the bell all say
 *    4 items / ₪296 (2 blocking); the bell item lands on /dashboard/approvals.
 *  - Every role: the first "מחכה לך" row (or the board) is above the fold at
 *    375×667; staff pages carry no "₪".
 *  - The owner of both lab branches gets "פתחו שם" on the other branch's invoice.
 *  - DoD-1 screenshots (he 390/1440, en 1440) + axe (0 critical/serious).
 */

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = 'e2e/__screenshots__/W2-08';
const PHONE_SMALL = { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const ROLES = ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'] as const;
const email = (role: string) => `${role}@kfar-hazeitim.test`;
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

// Run the lab dev server under faketime (README §3, 7.11 note): the server's clock is 25.10.
test.describe.configure({ timeout: 300_000 });

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    // The lab worker banner would push the fold: mock a healthy worker.
    await sql`insert into worker_heartbeats (worker_id, host, pid, workers, started_at, beat_at)
              values ('e2e-w2-08', 'e2e', 1, 1, now(), now() + interval '1 day')
              on conflict (worker_id) do update set beat_at = now() + interval '1 day'`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from worker_heartbeats where worker_id = 'e2e-w2-08'`;
  } finally {
    await sql.end();
  }
});

/** One magic-link login per role per run (the sign-in rate limit), then reused as storage state. */
const states = new Map<string, Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>>();

async function asRole(browser: Browser, role: string, opts: Parameters<Browser['newContext']>[0], baseURL: string, locale: 'he' | 'en' = 'he') {
  const cookies = [
    { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
    { name: 'rm_locale', value: locale, url: baseURL },
  ];
  const saved = states.get(role);
  const context = await browser.newContext({ ...opts, baseURL, ...(saved ? { storageState: saved } : {}) });
  await context.addCookies(cookies);
  const page = await context.newPage();
  if (!saved) {
    await loginViaMagicLink(page, email(role));
    states.set(role, await context.storageState());
  }
  return { context, page };
}

async function axeSerious(page: Page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, exclude: [['[data-testid="worker-status"]']] } as object);
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`);
  });
}

const digits = (s: string) => s.replace(BIDI, '').replace(/[^\d.]/g, '');

test.describe('owner: one figure on the home row, the badge and the bell', () => {
  test('4 items · ₪296 · 2 blocking, everywhere', async ({ browser, baseURL }) => {
    const { context, page } = await asRole(browser, 'owner', DESKTOP, baseURL!);
    await page.goto('/dashboard');
    const row = page.getByTestId('needs-decision:mine');
    await expect(row).toBeVisible();
    expect(digits(await page.getByTestId('needs-decision:mine-value').innerText())).toBe('296');
    await expect(page.getByTestId('needs-decision:mine-sub')).toContainText('2 חוסמים תשלום');

    const link = page.locator('aside a[href="/dashboard/approvals"], nav a[href="/dashboard/approvals"]').first();
    // The accessible name = the visible label + an sr-only badge suffix (no aria-label override).
    const sr = link.locator('[data-badge-sr]');
    await expect.poll(async () => (await sr.textContent().catch(() => '')) ?? '', { timeout: 20_000 }).toContain('4 פריטים');
    const aria = ((await link.textContent()) ?? '').replace(BIDI, '');
    expect(aria).toMatch(/296/);
    expect(aria).toContain('חוסם תשלום');
    await expect(link.locator('[data-nav-badge="block"]')).toBeVisible();
    // Badges are not tab stops: nothing inside the link is focusable on its own.
    expect(await link.locator('[tabindex], button, a').count()).toBe(0);

    // The bell: same task, lands on its card; focus returns to the bell on close.
    await page.getByTestId('bell-trigger').click();
    const panel = page.getByTestId('bell-panel');
    await expect(panel).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/owner-bell-he-1440.png` });
    expect(await axeSerious(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('bell-trigger')).toBeFocused();
    await page.getByTestId('bell-trigger').click();
    const item = panel.getByTestId('bell-item-decision');
    expect(digits(await item.innerText())).toContain('296');
    await item.click();
    await expect(page).toHaveURL(/\/dashboard\/approvals/);
    await context.close();
  });

  test('the cross-branch 404 offers "פתחו שם" to the owner of both branches', async ({ browser, baseURL }) => {
    const sql = e2eSql();
    let invoiceId = '';
    try {
      const rows = await sql<{ id: string }[]>`
        select i.id from invoices i join restaurants r on r.id = i.restaurant_id
        where r.name <> ${DEMO_RESTAURANT_NAME} and r.name like ${DEMO_RESTAURANT_NAME + '%'} limit 1`;
      invoiceId = rows[0]?.id ?? '';
    } finally {
      await sql.end();
    }
    test.skip(!invoiceId, 'the e2e seed has no second branch with invoices');
    const { context, page } = await asRole(browser, 'owner', DESKTOP, baseURL!);
    await page.goto(`/dashboard/invoices/${invoiceId}`);
    await expect(page.getByTestId('dashboard-not-found')).toBeVisible();
    const open = page.getByTestId('where-is-open');
    await expect(open).toBeVisible({ timeout: 20_000 });
    expect(await open.getAttribute('href')).toMatch(/^\/dashboard\/go\?r=[0-9a-f-]+&to=%2Fdashboard%2Finvoices%2F/);
    await page.screenshot({ path: `${SHOTS}/owner-404-he-1440.png` });
    expect(await axeSerious(page)).toEqual([]);
    await context.close();
  });
});

for (const role of ROLES) {
  test(`${role}: first "מחכה לך" row above the fold at 375×667; staff see no ₪; DoD-1 shots`, async ({ browser, baseURL }) => {
    const staff = role === 'receiver' || role === 'chef';
    {
      const { context, page } = await asRole(browser, role, PHONE_SMALL, baseURL!);
      await page.goto('/dashboard');
      await expect(page.locator(`[data-home="${role}"]`)).toBeVisible();
      const first = role === 'receiver' ? page.getByTestId('receiving-board').first() : page.locator('[data-needs-row], [data-testid="needs-you-zero"], [data-testid="chef-count"]').first();
      await expect(first).toBeVisible();
      const box = await first.boundingBox();
      expect(box!.y, 'the first row starts above the fold').toBeLessThan(667);
      if (staff) {
        await page.waitForLoadState('networkidle');
        expect(await page.locator('body').innerText()).not.toContain('₪');
      }
      await context.close();
    }
    for (const [opts, locale, w] of [[PHONE, 'he', 390], [DESKTOP, 'he', 1440], [DESKTOP, 'en', 1440]] as const) {
      const { context, page } = await asRole(browser, role, opts, baseURL!, locale);
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${SHOTS}/${role}-home-${locale}-${w}.png`, fullPage: false });
      expect(await axeSerious(page), `${role} ${locale} ${w}`).toEqual([]);
      if (staff) expect(await page.locator('body').innerText()).not.toContain('₪');
      await context.close();
    }
  });
}
