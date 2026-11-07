import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W2-07 · the inventory count as a field instrument, with an audited denominator.
 *
 * The chef at 375×667 with touch walks the count with Enter only (0 taps per
 * line), meets the "999" guard (no ₪ for the chef), keeps 20 lines through a
 * dead network and a reload (synced exactly once) and hands the count off; the
 * manager closes it; no ₪ key reaches the chef's network JSON; ₪ sits left of
 * the digits in Hebrew; axe he + en.
 *
 * Fixture: the demo tenant's flag on, its counts cleared, and an opening count
 * 20 days back with a last-time qty of 8 on its first 24 food products.
 */
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const FIELD = { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true };
const CHEF = 'chef@kfar-hazeitim.test';
const MANAGER = 'manager@kfar-hazeitim.test';
const MONEY_KEYS = /"(unitCost|valueAgorot|prevValueAgorot|priceSource|totalValueAgorot|foodValueAgorot|foodSalesExVat)"/;

let restaurantId = '';
let settingsBefore = '';
/** The line the chef fat-fingers to 999 (shared with the manager's test). */
let trapId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string; settings: string }[]>`
      select id, coalesce(settings, '{}'::jsonb)::text as settings from restaurants where name = ${DEMO_RESTAURANT_NAME} order by created_at limit 1`;
    if (!r) throw new Error('no demo restaurant');
    restaurantId = r.id;
    settingsBefore = r.settings;
    await sql`update restaurants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features}',
      coalesce(settings -> 'features', '{}'::jsonb) || '{"inventoryCount": true}'::jsonb) where id = ${restaurantId}`;
    await sql`delete from inventory_counts where restaurant_id = ${restaurantId}`;
    const [open] = await sql<{ id: string }[]>`
      insert into inventory_counts (restaurant_id, count_date, status, total_value_agorot, completed_at)
      values (${restaurantId}, (now() at time zone 'Asia/Jerusalem')::date - 20, 'completed', 0, now()) returning id`;
    // Last time: 8 of each product the count will list (food bought in the last 60 days).
    await sql`
      insert into inventory_count_lines (restaurant_id, count_id, product_id, storage_area, unit, qty)
      select ${restaurantId}, ${open!.id}, p.id, 'fridge', coalesce(nullif(trim(p.default_unit), ''), 'יח׳'), 8
      from products p
      where p.restaurant_id = ${restaurantId}
        and exists (select 1 from price_history ph where ph.product_id = p.id and ph.restaurant_id = ${restaurantId})
      order by p.canonical_name limit 24`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from inventory_counts where restaurant_id = ${restaurantId}`;
    await sql`update restaurants set settings = ${settingsBefore}::text::jsonb where id = ${restaurantId}`;
  } finally {
    await sql.end();
  }
});

async function signIn(browser: Browser, email: string, locale: 'he' | 'en', use = FIELD) {
  const ctx = await browser.newContext({ ...use, baseURL: test.info().project.use.baseURL });
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await ctx.addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  const page = await ctx.newPage();
  await loginViaMagicLink(page, email, '/dashboard');
  return page;
}

async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  });
}

const qtyInputs = (page: Page) => page.locator('main input[inputmode="decimal"][id^="qty-"]');

test('the chef walks the count with Enter, meets the guard without ₪, survives a dead network, and hands off', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await signIn(browser, CHEF, 'he');
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/trpc/inventory.')) bodies.push(await r.text().catch(() => ''));
  });
  try {
    await page.goto('/dashboard/inventory/count');
    await page.getByRole('button', { name: 'התחלת ספירה' }).click();
    await expect(page.getByTestId('count-field')).toHaveAttribute('data-mode', 'field');
    const inputs = qtyInputs(page);
    await expect(inputs.first()).toBeVisible();
    const n = await inputs.count();
    expect(n).toBeGreaterThanOrEqual(17);
    // Last time, muted, never prefilled.
    await expect(page.getByTestId('last-time').first()).toContainText('בפעם הקודמת 8');
    await expect(inputs.first()).toHaveValue('');
    expect(await axe(page), 'he /count axe').toEqual([]);

    // Enter walks 17 lines with 0 taps: type, Enter, and focus is on the next qty field (never a select).
    await inputs.first().focus();
    for (let i = 0; i < 17; i++) {
      await page.keyboard.type('7');
      await page.keyboard.press('Enter');
      const tag = await page.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}`);
      if (i < Math.min(16, n - 1)) expect(tag).toMatch(/^INPUT#qty-/);
    }
    await expect(page.getByTestId('count-progress')).toContainText('נספרו 17 מתוך');

    // The fat-finger guard: 999 on a line whose last count was 8 → instant warning, no ₪ for the chef.
    const last = inputs.nth(17);
    trapId = (await last.getAttribute('id'))!.replace(/^qty-/, '');
    await last.fill('999');
    const guard = page.getByTestId(`line-${trapId}`).getByTestId('qty-guard');
    await expect(guard).toBeVisible();
    await expect(guard).not.toContainText('₪');

    // No signal: the next lines stay on the device, a reload keeps them, and they sync exactly once.
    let saves = 0;
    await page.route('**/api/trpc/inventory.saveLines**', (route) => route.abort('internetdisconnected'));
    const offline = Math.min(20, n) - 18;
    for (let i = 0; i < offline; i++) await inputs.nth(18 + i).fill('3');
    await inputs.nth(18).blur();
    await expect(page.getByTestId('count-queue')).toBeVisible({ timeout: 15_000 });
    // Reload with the network still dead for saves: the quantities come back from the device.
    await page.reload();
    await expect(qtyInputs(page).nth(18)).toHaveValue('3');
    await expect(page.getByTestId('count-queue')).toBeVisible({ timeout: 15_000 });
    // Signal back: exactly one save carries the queue.
    await page.unroute('**/api/trpc/inventory.saveLines**');
    page.on('request', (r) => {
      if (r.url().includes('/api/trpc/inventory.saveLines') && r.method() === 'POST') saves += 1;
    });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('count-queue')).toHaveCount(0, { timeout: 30_000 });
    await page.waitForTimeout(2500);
    const sql = e2eSql();
    try {
      const rows = await sql<{ n: number }[]>`
        select count(*)::int as n from inventory_count_lines l join inventory_counts c on c.id = l.count_id
        where c.restaurant_id = ${restaurantId} and c.status = 'draft' and l.qty is not null`;
      expect(rows[0]!.n).toBeGreaterThanOrEqual(17 + offline);
    } finally {
      await sql.end();
    }
    expect(saves, 'the queued batch is replayed once').toBe(1);

    // Hand-off: one primary, bottom third, full width, ≥56 px.
    const primary = page.getByTestId('count-submit');
    const box = (await primary.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.width).toBeGreaterThanOrEqual(375 - 40);
    expect(box.y).toBeGreaterThan((667 * 2) / 3 - box.height);
    await primary.click();
    await expect(page.getByTestId('count-submit')).toHaveText(/נשלח למנהל לסגירה/, { timeout: 20_000 });
    const targets = async () => {
      const sql2 = e2eSql();
      try {
        return await sql2<{ target: string }[]>`
          select target from notifications_outbox where restaurant_id = ${restaurantId} and related_entity_type = 'inventory_count'`;
      } finally {
        await sql2.end();
      }
    };
    await expect.poll(async () => (await targets()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    expect((await targets()).every((o) => o.target.includes('@') && !o.target.startsWith('role:'))).toBe(true);

    // No ₪ key ever reached the chef.
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(MONEY_KEYS);
  } finally {
    await page.context().close();
  }
});

test('the manager sees "ready to close", confirms the flag and closes; focus lands on the summary', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await signIn(browser, MANAGER, 'he', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    await page.goto('/dashboard/inventory');
    await expect(page.getByTestId('ready-to-close')).toBeVisible();
    await page.getByRole('link', { name: 'המשך ספירה' }).click();
    // The money viewer's guard names the ₪.
    await expect(page.getByTestId(`line-${trapId}`).getByTestId('qty-guard')).toContainText('₪');
    await page.getByTestId('count-finish').click();
    await expect(page.getByTestId('flags-panel')).toBeVisible();
    await expect(page.getByTestId('finish-confirm')).toBeDisabled();
    await page.getByRole('button', { name: 'חזרה לספירה' }).click();
    const confirms = page.getByTestId('guard-confirm');
    while ((await confirms.count()) > 0) await confirms.first().click();
    await page.getByTestId('count-finish').click();
    const accept = page.getByTestId('uncounted-list').getByRole('checkbox');
    if (await accept.count()) await accept.check();
    await page.getByTestId('finish-confirm').click();
    await expect(page.getByTestId('count-done')).toBeVisible();
    await expect(page.getByTestId('count-done-title')).toBeFocused();
    await expect(page.getByTestId('count-done-stock')).toContainText('כולל בר ומשקאות');

    // ₪ left of the first digit (he), on the summary's hero figure.
    const side = await page.getByTestId('count-done-value').evaluate((el) => {
      const text = el.textContent ?? '';
      const node = (function find(n: Node): Text | null {
        if (n.nodeType === 3 && (n.textContent ?? '').includes('₪')) return n as Text;
        for (const c of Array.from(n.childNodes)) {
          const f = find(c);
          if (f) return f;
        }
        return null;
      })(el);
      if (!node) return `no ₪ in "${text}"`;
      const s = node.textContent!;
      const r = document.createRange();
      r.setStart(node, s.indexOf('₪'));
      r.setEnd(node, s.indexOf('₪') + 1);
      const sym = r.getBoundingClientRect();
      const d = s.search(/\d/);
      r.setStart(node, d);
      r.setEnd(node, d + 1);
      const dig = r.getBoundingClientRect();
      return sym.left < dig.left ? 'left' : 'right';
    });
    expect(side).toBe('left');
    expect(await axe(page), 'he done axe').toEqual([]);
  } finally {
    await page.context().close();
  }
});

test('the closed count reads as a table with "not counted" listed; axe in English too', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await signIn(browser, MANAGER, 'en', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  try {
    await page.goto('/dashboard/inventory');
    await expect(page.getByTestId('history-stock-line').first()).toContainText('incl. bar and beverages');
    await page.getByTestId('count-history').getByRole('link').first().click();
    await expect(page.getByTestId('stock-line')).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    expect(await axe(page), 'en detail axe').toEqual([]);
    // Tab-walk: every focus stop is visible (not hidden under sticky chrome).
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const ok = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return true;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      expect(ok).toBe(true);
    }
  } finally {
    await page.context().close();
  }
});

// TODO(W2-07 → W2-08): the bookkeeper's nav/route access to /dashboard/inventory needs nav-registry.test.ts's
// one-line exception (W2-08's file). The server read tier is in place and tested (inventory-roles.test.ts).
test.fixme('the bookkeeper reads the closed count (no write controls)', async () => {});
