import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W1-07 · money-named approvals, on the seeded demo owner.
 *
 * A fixture invoice (due yesterday) carries three BLOCK findings so they sort
 * first in the priority order: a PRICE_HIGHER with the full why-line facts, a
 * QTY_OVER and a second PRICE_HIGHER. Every test re-arms them to `open`.
 *
 *   - phone 390×844: the first card's 50/50 48 px pair is above the fold, the
 *     filters fold into one chip, ₪ sits left of its digits in he;
 *   - approve: optimistic exit, focus moves to the next card, a 10 s undo that
 *     really reopens the row (DB), tiles = server totals;
 *   - "pay as billed": one tap on a reason chip, reasonCode in the audit;
 *   - a stale card gets the decider named instead of overwriting;
 *   - axe (WCAG 2.2 AA + best practice): 0 critical/serious, he + en.
 */
test.use({ storageState: OWNER_STATE });

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const TAG = 'e2e-W1-07';

interface Fx {
  restaurantId: string;
  ownerId: string;
  invoiceId: string;
  priceId: string;
  qtyId: string;
  price2Id: string;
}
let fx: Fx;

async function setLocale(page: Page, locale: 'he' | 'en') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const [owner] = await sql<{ id: string }[]>`
      select user_id as id from memberships where restaurant_id = ${r!.id} and role = 'owner' limit 1`;
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r!.id} order by name limit 1`;
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, status, source, source_ref, sent_at, notes)
      values (${r!.id}, ${sup!.id}, 'sent', 'manual', 'PO-W107', now() - interval '10 days', ${TAG}) returning id`;
    const [pl] = await sql<{ id: string }[]>`
      insert into po_lines (po_id, raw_description, qty_ordered, unit, unit_price_expected)
      values (${po!.id}, 'בירה מהחבית', 2, 'חבית', 522.6) returning id`;
    const [inv] = await sql<{ id: string }[]>`
      insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, due_date, total_excl_vat, total_incl_vat, status, source)
      values (${r!.id}, ${sup!.id}, 'W107-1', now() - interval '6 days', now() - interval '1 day', 2000, 2360, 'matched', 'manual')
      returning id`;
    const [il] = await sql<{ id: string }[]>`
      insert into invoice_lines (invoice_id, raw_description, qty_billed, unit, unit_price_billed, line_total)
      values (${inv!.id}, 'בירה מהחבית', 2, 'חבית', 575, 1150) returning id`;
    const [mr] = await sql<{ id: string }[]>`
      insert into match_runs (restaurant_id, invoice_id, po_id, overall_status, total_discrepancy_amount)
      values (${r!.id}, ${inv!.id}, ${po!.id}, 'blocked', 204.3) returning id`;
    const ins = async (type: string, delta: number, extra: { exp?: number; act?: number; tol?: string; il?: string; pl?: string }) => {
      const [d] = await sql<{ id: string }[]>`
        insert into discrepancies (match_run_id, restaurant_id, type, severity, delta_amount, expected_value, actual_value,
          tolerance_used, requires_role, resolution_status, invoice_line_id, po_line_id, rule_id)
        values (${mr!.id}, ${r!.id}, ${type}, 'block', ${delta}, ${extra.exp ?? null}, ${extra.act ?? null}, ${extra.tol ?? null},
          'owner', 'open', ${extra.il ?? null}, ${extra.pl ?? null}, ${TAG})
        returning id`;
      return d!.id;
    };
    // Biggest ₪ first inside the same severity + due date.
    const priceId = await ins('PRICE_HIGHER', 104.8, { exp: 522.6, act: 575, tol: 'price: ±2% or ₪5', il: il!.id, pl: pl!.id });
    const qtyId = await ins('QTY_OVER', 60.5, { exp: 6.5, act: 9.5, tol: 'billed quantity exceeds received quantity' });
    const price2Id = await ins('PRICE_HIGHER', 39, { exp: 89, act: 96, tol: 'price: ±2% or ₪5' });
    fx = { restaurantId: r!.id, ownerId: owner!.id, invoiceId: inv!.id, priceId, qtyId, price2Id };
  } finally {
    await sql.end();
  }
});

test.beforeEach(async () => {
  const sql = e2eSql();
  try {
    await sql`
      update discrepancies set resolution_status = 'open', resolved_by = null, resolved_at = null, resolution_note = null,
        requires_role = 'owner'
      where rule_id = ${TAG}`;
    await sql`delete from activity_events where entity_id in ${sql([fx.priceId, fx.qtyId, fx.price2Id])}`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    const ids = [fx.priceId, fx.qtyId, fx.price2Id];
    await sql`delete from activity_events where entity_id in ${sql(ids)}`;
    await sql`delete from discrepancies where rule_id = ${TAG}`;
    await sql`delete from match_runs where invoice_id = ${fx.invoiceId}`;
    await sql`delete from invoice_lines where invoice_id = ${fx.invoiceId}`;
    await sql`delete from invoices where id = ${fx.invoiceId}`;
    await sql`delete from po_lines where po_id in (select id from purchase_orders where notes = ${TAG})`;
    await sql`delete from purchase_orders where notes = ${TAG}`;
  } finally {
    await sql.end();
  }
});

async function dbStatus(id: string): Promise<string> {
  const sql = e2eSql();
  try {
    const [d] = await sql<{ s: string }[]>`select resolution_status as s from discrepancies where id = ${id}`;
    return d!.s;
  } finally {
    await sql.end();
  }
}

const card = (page: Page, nth = 0) => page.getByTestId('approval-card').nth(nth);
/** The fixture's cards only (the seed has its own beer-keg finding). */
const fxCard = (page: Page, text: string) =>
  page.getByTestId('approval-card').filter({ hasText: 'W107-1' }).filter({ hasText: text });

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      // `next dev`'s overlay and the lab worker banner are not part of this package.
      { exclude: [['nextjs-portal'], ['[data-testid="worker-status"]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `${v.id} @ ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test.describe('phone 390×844', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

  test('the first decision is above the fold: two 50/50 48 px buttons, filters folded, ₪ left of its digits', async ({ page }) => {
    const errors = collectPageErrors(page);
    await setLocale(page, 'he');
    await page.goto('/dashboard/approvals');
    const first = card(page);
    await expect(first).toContainText('בירה מהחבית');
    const approve = first.getByTestId('decide-approve');
    const reject = first.getByTestId('decide-reject');
    await expect(approve).toHaveText(/דרוש .*104\.80.* מהספק/);
    await expect(reject).toHaveText('שלם כפי שחויב');
    const a = (await approve.boundingBox())!;
    const r = (await reject.boundingBox())!;
    expect(a.height).toBeGreaterThanOrEqual(48);
    expect(r.height).toBeGreaterThanOrEqual(48);
    expect(Math.abs(a.width - r.width)).toBeLessThan(2);
    expect(a.y + a.height).toBeLessThanOrEqual(PHONE.height);
    // The claim sits at the start (right in RTL).
    expect(a.x).toBeGreaterThan(r.x);
    // Filters fold into one chip; the toolbar is not on screen until opened.
    await expect(page.getByTestId('approvals-filters-toggle')).toBeVisible();
    await expect(page.locator('#approvals-filters')).toBeHidden();
    // Why-line in the card: billed × qty instead of the order price.
    await expect(first.getByTestId('why-line')).toContainText('PO-W107');
    // he-IL ₪: the glyph is LEFT of the first digit.
    const amount = first.getByTestId('card-amount');
    const pos = await amount.evaluate((el) => {
      const text = el.textContent ?? '';
      const range = document.createRange();
      const node = el.firstChild!;
      const at = (i: number) => {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        return range.getBoundingClientRect().x;
      };
      return { shekel: at(text.indexOf('₪')), digit: at(text.search(/\d/)) };
    });
    expect(pos.shekel).toBeLessThan(pos.digit);
    expect(errors).toEqual([]);
  });

  test('approve: optimistic exit, focus to the next card, 10 s undo that really reopens', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/dashboard/approvals');
    const before = Number(await page.getByTestId('approvals-summary-line').locator('bdi').first().textContent());
    await card(page).getByTestId('decide-approve').click();
    await expect(fxCard(page, 'בירה מהחבית')).toHaveCount(0);
    // Focus moved to the next card's primary, not to <body>.
    await expect(page.locator(':focus')).toHaveAttribute('data-testid', 'decide-approve');
    await expect(page.getByTestId('approvals-announcer')).toContainText('נדרש מהספק');
    await expect(page.getByTestId('approvals-undo')).toContainText('נדרש מהספק');
    await expect.poll(() => dbStatus(fx.priceId)).toBe('accepted');
    await expect(page.getByTestId('approvals-summary-line').locator('bdi').first()).toHaveText(String(before - 1));

    await page.getByTestId('approvals-undo-button').click();
    await expect(fxCard(page, 'בירה מהחבית')).toHaveCount(1);
    await expect.poll(() => dbStatus(fx.priceId)).toBe('open');
    await expect(page.getByTestId('approvals-summary-line').locator('bdi').first()).toHaveText(String(before));
    // Back at its own index (first).
    await expect(card(page)).toContainText('בירה מהחבית');
  });

  test('"pay as billed" commits with one tap on a reason chip and stores the code', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/dashboard/approvals');
    const target = fxCard(page, 'חויבו');
    await target.getByTestId('decide-reject').click();
    const reasons = target.getByTestId('waive-reasons');
    await expect(reasons).toBeVisible();
    // Focus lands on the first chip; Esc closes and returns to the button.
    await expect(reasons.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(target.getByTestId('decide-reject')).toBeFocused();
    await target.getByTestId('decide-reject').click();
    await target.getByRole('button', { name: 'הגיע בפועל, הקבלה שגויה' }).click();
    await expect(target).toHaveCount(0);
    await expect.poll(() => dbStatus(fx.qtyId)).toBe('rejected');
    const sql = e2eSql();
    try {
      const [a] = await sql<{ after: { reasonCode?: string } }[]>`
        select after from audit_log where entity_id = ${fx.qtyId} and action = 'discrepancy.rejected' order by at desc limit 1`;
      expect(a!.after.reasonCode).toBe('received_actual');
    } finally {
      await sql.end();
    }
  });

  test('a stale card names who decided instead of overwriting', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/dashboard/approvals');
    await expect(card(page)).toContainText('בירה מהחבית');
    // Someone else decides while this card is on screen.
    const sql = e2eSql();
    try {
      await sql`
        update discrepancies set resolution_status = 'rejected', resolved_by = null, resolved_at = now(), resolution_note = 'x'
        where id = ${fx.priceId}`;
      // A manager on another device (no user row: the name falls back to the role).
      await sql`
        insert into audit_log (restaurant_id, user_id, action, entity_type, entity_id, after)
        values (${fx.restaurantId}, null, 'discrepancy.rejected', 'discrepancy', ${fx.priceId},
          ${sql.json({ status: 'rejected', role: 'manager' })})`;
    } finally {
      await sql.end();
    }
    await card(page).getByTestId('decide-approve').click();
    await expect(page.getByRole('status').filter({ hasText: 'כבר הוחלט ע״י מנהל' }).first()).toBeVisible();
    expect(await dbStatus(fx.priceId)).toBe('rejected');
  });
});

for (const locale of ['he', 'en'] as const) {
  test(`desktop 1440 ${locale}: server tiles, ⋯ menu, axe clean`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await setLocale(page, locale);
    const errors = collectPageErrors(page);
    await page.goto('/dashboard/approvals');
    await expect(card(page)).toBeVisible();
    // Tiles come from approvals.queueSummary (whole queue, not the page).
    const res = await page.request.get(`/api/trpc/approvals.queueSummary?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`);
    const summary = ((await res.json()) as { result: { data: { json: { count: number } } } }).result.data.json;
    await expect(page.getByTestId('summary-count')).toHaveText(String(summary.count));
    // Escalate and evidence live in ⋯, not next to the money buttons.
    await card(page).getByTestId('card-more').click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card(page).getByTestId('card-more')).toBeFocused();
    expect(await axeSerious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
