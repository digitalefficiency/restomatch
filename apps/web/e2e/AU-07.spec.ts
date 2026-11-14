import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { authenticator } from 'otplib';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, ensurePasswordUser } from './helpers';

/**
 * AU-07 · /admin/automation — the measured automation KPIs of the demo tenant,
 * desktop 1440, Hebrew and English: 8 Israel weeks, "לא נמדד" for opened
 * alerts, ₪ through <Money> (glyph left of the digits in Hebrew), the time
 * ledger apart from the funnel, axe clean, Tab reaches the controls.
 */

const DESK = { viewport: { width: 1440, height: 900 } };
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const EMAIL = 'e2e-au07-admin@restomatch.test';
const PASSWORD = 'AU-07-e2e-password-2026!';
const SECRET = authenticator.generateSecret();
const MARK = 'au07-e2e';

let restaurantId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await ensurePasswordUser({ email: EMAIL, password: PASSWORD, totpSecret: SECRET });
  const sql = e2eSql();
  try {
    await sql`update users set is_platform_admin = true where email = ${EMAIL}`;
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    restaurantId = r!.id;
    // One alert this week, so the alerts table (and its "opened: not measured" cell) renders.
    await sql`delete from notifications_outbox where dedupe_key like ${MARK + ':%'}`;
    await sql`insert into notifications_outbox (restaurant_id, channel, target, body, status, last_error, dedupe_key)
      values (${restaurantId}, 'whatsapp', '+972500000000', 'e2e', 'failed', 'skipped_no_provider', ${MARK + ':1'})`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from notifications_outbox where dedupe_key like ${MARK + ':%'}`;
    await sql`update users set is_platform_admin = false where email = ${EMAIL}`;
  } finally {
    await sql.end();
  }
});

type StorageState = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>>;
let state: StorageState | null = null;

/** One password + TOTP sign-in for the file (a TOTP code is single-use per 30 s step). */
async function adminState(browser: Browser, baseURL: string): Promise<StorageState> {
  if (state) return state;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form:has(#password) button[type=submit]').click();
  const code = page.locator('input[name="code"]');
  await code.waitFor({ timeout: 60_000 });
  await code.fill(authenticator.generate(SECRET));
  await code.press('Enter');
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  state = await ctx.storageState();
  await ctx.close();
  return state;
}

async function adminPage(browser: Browser, baseURL: string, locale: 'he' | 'en'): Promise<Page> {
  const ctx = await browser.newContext({ ...DESK, baseURL, storageState: await adminState(browser, baseURL) });
  await ctx.addCookies([
    { name: 'rm_locale', value: locale, url: baseURL },
    { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
  ]);
  const page = await ctx.newPage();
  await page.goto(`/admin/automation?r=${restaurantId}&w=8`);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  return page;
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['#main-content [role=status]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

for (const locale of ['he', 'en'] as const) {
  test(`${locale} · 1440: 8 weeks, not-measured alerts, ledger apart, axe, Tab`, async ({ browser, baseURL }) => {
    const page = await adminPage(browser, baseURL!, locale);
    const t = locale === 'he'
      ? { title: 'אוטומציה · מדדים', notMeasured: 'לא נמדד', ledger: 'שווי זמן (הערכה)', caveat: 'עלות מנהלת חשבונות חיצונית יורדת רק אם התעריף יורד.' }
      : { title: 'Automation · metrics', notMeasured: 'Not measured', ledger: 'Time value (estimate)', caveat: 'An external bookkeeper costs less only if her fee goes down.' };

    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await expect(page.getByTestId('au07-ops').locator('tbody tr')).toHaveCount(8);
    await expect(page.getByTestId('au07-funnel').locator('tbody tr')).toHaveCount(8);
    await expect(page.getByTestId('au07-alerts').getByText(t.notMeasured).first()).toBeVisible();
    const ledger = page.getByTestId('au07-ledger');
    await expect(ledger.getByRole('heading', { name: t.ledger })).toBeVisible();
    await expect(ledger.getByText(t.caveat)).toBeVisible();
    // The ledger is its own section, never inside the funnel table.
    await expect(page.getByTestId('au07-funnel').getByTestId('au07-ledger')).toHaveCount(0);

    if (locale === 'he') {
      // ₪ renders to the LEFT of its digits in Hebrew (he-IL currency format inside RTL).
      const sides = await page.getByTestId('au07-funnel').evaluate((table) => {
        const out: boolean[] = [];
        const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent ?? '';
          const sh = text.indexOf('₪');
          const dg = text.search(/\d/);
          if (sh < 0 || dg < 0) continue;
          const box = (i: number) => {
            const r = document.createRange();
            r.setStart(n!, i);
            r.setEnd(n!, i + 1);
            return r.getBoundingClientRect();
          };
          out.push(box(sh).left < box(dg).left);
        }
        return out;
      });
      expect(sides.length).toBeGreaterThan(0);
      expect(sides.every(Boolean)).toBe(true);
    }

    expect(await axeSerious(page)).toEqual([]);

    // Tab reaches the restaurant picker and the "show" button.
    const reached = new Set<string>();
    for (let i = 0; i < 40 && reached.size < 2; i++) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '';
        if (el.tagName === 'SELECT' && el.getAttribute('name') === 'r') return 'picker';
        if (el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit' && el.closest('form[method="get"]')) return 'show';
        return '';
      });
      if (tag) reached.add(tag);
    }
    expect([...reached].sort()).toEqual(['picker', 'show']);

    await page.screenshot({ path: `e2e/__screenshots__/AU-07/automation-${locale}-1440.png`, fullPage: true });
    await page.context().close();
  });
}
