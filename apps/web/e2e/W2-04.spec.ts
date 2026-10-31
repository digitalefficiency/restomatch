import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W2-04 · the approvals desk, on the seeded demo owner.
 *
 * Fixture (owner-routed, warn, due in 20 days, so W1-07's block rows sort first):
 *   W204-1 · two gaps · ₪100.00 + ₪50.00 = ₪150.00 → the group primary is offered;
 *   W204-2 · two gaps · ₪150.00 + ₪60.00 = ₪210.00 → over the ₪200 per-invoice cap;
 *   W204-3 · one manager-routed gap (the escalation test).
 */
test.use({ storageState: OWNER_STATE });

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TAG = 'e2e-W2-04';
const PHONE = { width: 390, height: 844 };

interface Fx {
  restaurantId: string;
  inv: Record<'a' | 'b' | 'c', string>;
  a: [string, string];
  b: [string, string];
  c: string;
}
let fx: Fx;

async function setLocale(page: Page, locale: 'he' | 'en') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
}

async function cleanup(sql: ReturnType<typeof e2eSql>) {
  await sql`delete from recovery_events where claim_id in (select c.id from recovery_claims c join discrepancies d on d.id = c.discrepancy_id where d.rule_id = ${TAG})`;
  await sql`delete from recovery_claims where discrepancy_id in (select id from discrepancies where rule_id = ${TAG})`;
  await sql`delete from notifications_outbox where related_entity_id in (select id from discrepancies where rule_id = ${TAG})`;
  await sql`delete from activity_events where entity_id in (select id from discrepancies where rule_id = ${TAG})`;
  await sql`delete from audit_log where entity_id in (select id from discrepancies where rule_id = ${TAG})`;
  await sql`delete from discrepancies where rule_id = ${TAG}`;
  await sql`delete from match_runs where invoice_id in (select id from invoices where invoice_number like 'W204-%')`;
  await sql`delete from invoices where invoice_number like 'W204-%'`;
}

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    await cleanup(sql);
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r!.id} order by name limit 1`;
    const invoice = async (n: string) => {
      const [inv] = await sql<{ id: string }[]>`
        insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, due_date, total_excl_vat, total_incl_vat, status, source)
        values (${r!.id}, ${sup!.id}, ${n}, now() - interval '3 days', now() + interval '20 days', 2000, 2340, 'matched', 'manual')
        returning id`;
      const [mr] = await sql<{ id: string }[]>`
        insert into match_runs (restaurant_id, invoice_id, overall_status, total_discrepancy_amount)
        values (${r!.id}, ${inv!.id}, 'major', 0) returning id`;
      return { inv: inv!.id, mr: mr!.id };
    };
    const gap = async (mr: string, delta: number, role = 'owner') => {
      const [d] = await sql<{ id: string }[]>`
        insert into discrepancies (match_run_id, restaurant_id, type, severity, delta_amount, requires_role, resolution_status, rule_id)
        values (${mr}, ${r!.id}, 'PRICE_HIGHER', 'warn', ${delta}, ${role}, 'open', ${TAG}) returning id`;
      return d!.id;
    };
    const A = await invoice('W204-1');
    const B = await invoice('W204-2');
    const C = await invoice('W204-3');
    fx = {
      restaurantId: r!.id,
      inv: { a: A.inv, b: B.inv, c: C.inv },
      a: [await gap(A.mr, 100), await gap(A.mr, 50)],
      b: [await gap(B.mr, 150), await gap(B.mr, 60)],
      c: await gap(C.mr, 20, 'manager'),
    };
  } finally {
    await sql.end();
  }
});

test.beforeEach(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from recovery_events where claim_id in (select c.id from recovery_claims c join discrepancies d on d.id = c.discrepancy_id where d.rule_id = ${TAG})`;
    await sql`delete from recovery_claims where discrepancy_id in (select id from discrepancies where rule_id = ${TAG})`;
    await sql`delete from notifications_outbox where related_entity_id in (select id from discrepancies where rule_id = ${TAG})`;
    await sql`
      update discrepancies set resolution_status = 'open', resolved_by = null, resolved_at = null, resolution_note = null
      where rule_id = ${TAG}`;
    await sql`update discrepancies set requires_role = 'manager' where id = ${fx.c}`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await cleanup(sql);
  } finally {
    await sql.end();
  }
});

async function statuses(ids: string[]): Promise<string[]> {
  const sql = e2eSql();
  try {
    const rows = await sql<{ id: string; s: string }[]>`
      select id, resolution_status as s from discrepancies where id in ${sql(ids)}`;
    return ids.map((id) => rows.find((r) => r.id === id)!.s);
  } finally {
    await sql.end();
  }
}

const group = (page: Page, n: string) => page.getByTestId('approval-group').filter({ hasText: n });
const cardsOf = (page: Page, n: string) => page.getByTestId('approval-card').filter({ hasText: n });

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['[data-testid="worker-status"]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => `${v.id} @ ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  });
}

test.describe('desktop 1440 he', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ page }) => setLocale(page, 'he'));

  test('cards group by invoice; the group primary only within the ₪200 cap', async ({ page }) => {
    await page.goto('/dashboard/approvals');
    const a = group(page, 'W204-1');
    await expect(a).toContainText('150.00');
    await expect(a).toContainText('₪');
    await expect(a).toContainText('2 פערים');
    await expect(a.getByTestId('group-approve')).toBeVisible();
    const b = group(page, 'W204-2');
    await expect(b.getByTestId('group-approve')).toHaveCount(0);
    await expect(b.getByTestId('group-why')).toBeVisible();
    // ₪ sits left of its first digit in he.
    const box = await a.getByTestId('group-at-risk').evaluate((el) => {
      const range = document.createRange();
      const text = el.firstChild as Text;
      const i = text.data.indexOf('₪');
      range.setStart(text, i);
      range.setEnd(text, i + 1);
      const sh = range.getBoundingClientRect();
      const d = text.data.search(/\d/);
      range.setStart(text, d);
      range.setEnd(text, d + 1);
      return { sh: sh.left, digit: range.getBoundingClientRect().left };
    });
    expect(box.sh).toBeLessThan(box.digit);

    await a.getByTestId('group-approve').click();
    await expect.poll(() => statuses(fx.a)).toEqual(['accepted', 'accepted']);
    const sql = e2eSql();
    try {
      const claims = await sql<{ n: number }[]>`select count(*)::int as n from recovery_claims where discrepancy_id in ${sql(fx.a)}`;
      expect(claims[0]!.n).toBe(2);
    } finally {
      await sql.end();
    }
    // 10 s undo, server-side (reopenMany).
    await page.getByTestId('approvals-undo-button').click();
    await expect.poll(() => statuses(fx.a)).toEqual(['open', 'open']);
  });

  test('2-pane evidence without navigation; ?sel= survives a reload; J/K + X; BatchBar Σ and the cap', async ({ page }) => {
    await page.goto('/dashboard/approvals');
    const first = cardsOf(page, 'W204-1').first();
    await first.getByTestId('card-evidence').click();
    await expect(page).toHaveURL(/[?&]sel=/);
    expect(new URL(page.url()).pathname).toBe('/dashboard/approvals');
    const pane = page.getByTestId('approvals-evidence-pane');
    await expect(pane.getByTestId('approval-evidence')).toBeVisible();
    const sel = new URL(page.url()).searchParams.get('sel');
    await page.reload();
    expect(new URL(page.url()).searchParams.get('sel')).toBe(sel);
    await expect(page.getByTestId('approvals-evidence-pane').getByTestId('approval-evidence')).toBeVisible();

    // Keys live on the list: J moves, X selects.
    const li = page.locator(`[data-row-id="${fx.b[0]}"]`);
    await li.focus();
    await page.keyboard.press('KeyX');
    await page.keyboard.press('KeyJ');
    await expect(page.locator(`[data-row-id="${fx.b[1]}"]`)).toBeFocused();
    await page.keyboard.press('KeyX');
    const bar = page.locator('[data-batchbar]');
    await expect(bar).toContainText('210.00');
    const approve = bar.getByRole('button', { name: 'אשרו את הנבחרים' });
    await expect(approve).toBeDisabled();
    await expect(bar).toContainText('חשבונית מעל');
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    expect(await statuses(fx.b)).toEqual(['open', 'open']);
  });

  test('history disclosure shows the trail', async ({ page }) => {
    await page.goto('/dashboard/approvals');
    const h = cardsOf(page, 'W204-2').first().getByTestId('approval-history');
    await h.locator('summary').click();
    await expect(h).toContainText(/אין עדיין החלטות|·/);
  });

  test('axe he: 0 critical / serious', async ({ page }) => {
    await page.goto('/dashboard/approvals');
    await expect(group(page, 'W204-1')).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
  });
});

test.describe('desktop 1536: three panes', () => {
  test.use({ viewport: { width: 1536, height: 900 } });
  test('list | document | decision', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto(`/dashboard/approvals?sel=${fx.a[0]}`);
    const doc = page.locator('[data-pane="document"]');
    const dec = page.locator('[data-pane="decision"]');
    await expect(doc).toBeVisible();
    const [list, d, k] = await Promise.all([
      page.getByTestId('approvals-list').boundingBox(),
      doc.boundingBox(),
      dec.boundingBox(),
    ]);
    // RTL: list at the start (right), then the document, then the decision.
    expect(list!.x).toBeGreaterThan(d!.x);
    expect(d!.x).toBeGreaterThan(k!.x);
  });
});

test.describe('phone 390', () => {
  test.use({ viewport: PHONE, hasTouch: true });
  test('evidence opens in a Peek with no navigation', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/dashboard/approvals');
    await cardsOf(page, 'W204-1').first().getByTestId('card-evidence').click();
    await expect(page.getByRole('dialog').getByTestId('approval-evidence')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/dashboard/approvals');
  });

  test('the [invoiceId] landing: one card, the 50/50 48 px pair in the bottom third', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto(`/dashboard/approvals/${fx.inv.a}`);
    await expect(page.getByTestId('approval-card')).toHaveCount(1);
    const pair = page.getByTestId('decide-pair');
    const ap = await pair.getByTestId('decide-approve').boundingBox();
    const rj = await pair.getByTestId('decide-reject').boundingBox();
    expect(ap!.height).toBeGreaterThanOrEqual(48);
    expect(Math.abs(ap!.width - rj!.width)).toBeLessThan(2);
    expect(ap!.y).toBeGreaterThan((PHONE.height * 2) / 3 - ap!.height);
    await pair.getByTestId('decide-approve').click();
    await expect.poll(async () => (await statuses(fx.a)).filter((s) => s === 'accepted').length).toBe(1);
    // The next card slides up in its place.
    await expect(page.getByTestId('approval-card')).toHaveCount(1);
  });
});

test.describe('manager: escalation sheet → an outbox row per owner', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });
  test('note chips, then a queued e-mail with ₪ and the go-link; the escalator keeps the row', async ({ page }) => {
    await setLocale(page, 'he');
    await loginViaMagicLink(page, 'manager@kfar-hazeitim.test', '/dashboard/approvals');
    const card = cardsOf(page, 'W204-3').first();
    await card.getByTestId('card-more').click();
    await page.getByRole('menuitem', { name: 'העבר לבעלים' }).click();
    await page.getByRole('button', { name: 'מחיר חריג' }).click();
    await page.getByTestId('escalate-send').click();
    await expect.poll(() => statuses([fx.c])).toEqual(['escalated']);
    const sql = e2eSql();
    try {
      const rows = await sql<{ target: string; body: string; status: string }[]>`
        select target, body, status from notifications_outbox where related_entity_id = ${fx.c}`;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.target).not.toMatch(/^role:/);
        expect(r.status).toBe('queued');
        expect(r.body).toContain('מחיר חריג');
        expect(r.body).toContain(`invoice%3D${fx.inv.c}`);
      }
    } finally {
      await sql.end();
    }
  });
});
