import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';

/**
 * W2-04 · the approvals desk, on the seeded demo owner.
 *
 * Fixture (owner-routed, warn, due in 20 days, so W1-07's block rows sort first):
 *   W204-1 · two gaps · ₪100.00 + ₪50.00 = ₪150.00 → "approve the whole invoice" is offered;
 *   W204-2 · two gaps · ₪150.00 + ₪60.00 = ₪210.00 → over the ₪200 per-invoice cap;
 *   W204-3 · one manager-routed gap (the escalation test).
 *
 * DS3-04: rows grouped by tier replace the invoice cards on purpose (SPEC §10.2); a gap is reached by its row
 * (`data-id`) or by `?sel=`, and its evidence (`approval-evidence`, keyed by `data-id`) holds the group action and the
 * history.
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

// Rows replace cards on purpose (DS3-04, SPEC §10.2): a fixture gap is its row, found by id.
const row = (p: Page, id: string) => p.locator(`[data-testid="approval-row"][data-id="${id}"]`);
const ev = (p: Page) => p.getByTestId('approval-evidence');

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

  test('approve the whole invoice from a gap\'s evidence, only within the ₪200 cap', async ({ page }) => {
    // Tiers replace invoice groups (DS3-04): "approve the whole invoice" lives in the evidence of a gap whose invoice
    // qualifies (W2-04's rows are PRICE_HIGHER: no VAT gap).
    await page.goto(`/dashboard/approvals?sel=${fx.a[0]}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.a[0]);
    await expect(ev(page).getByTestId('desk-group-more')).toContainText('עוד פער אחד בחשבונית');
    const groupApprove = ev(page).getByTestId('group-approve');
    await expect(groupApprove).toBeVisible();
    await expect(groupApprove).toContainText('150.00');
    await expect(groupApprove).toContainText('₪');
    // ₪ sits left of its first digit in he (the button's <Money> is one text node).
    const box = await groupApprove.locator('bdi').first().evaluate((el) => {
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
    // Over the ₪200 cap: no group action, one line says why.
    await page.goto(`/dashboard/approvals?sel=${fx.b[0]}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.b[0]);
    await expect(ev(page).getByTestId('group-approve')).toHaveCount(0);
    await expect(ev(page).getByTestId('group-why')).toBeVisible();

    await page.goto(`/dashboard/approvals?sel=${fx.a[0]}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.a[0]);
    await ev(page).getByTestId('group-approve').click();
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
    // The row's summary cell (DS3-04: rows replace cards).
    await row(page, fx.a[0]).getByTestId('card-evidence').click();
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
    // The history lives in the evidence of the selected gap (DS3-04).
    await page.goto(`/dashboard/approvals?sel=${fx.b[0]}`);
    const h = page.getByTestId('approvals-evidence-pane').getByTestId('approval-history');
    await h.locator('summary').click();
    await expect(h).toContainText(/אין עדיין החלטות|·/);
  });

  test('axe he: 0 critical / serious', async ({ page }) => {
    await page.goto('/dashboard/approvals');
    // The fixture's row (DS3-04: rows replace invoice groups).
    await expect(row(page, fx.a[0])).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
  });
});

test.describe('owner: a card escalated to me while open updates in place (warden LOW-5)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('CONFLICT "escalated" → "הועבר אליך", actions kept, the next tap decides', async ({ page }) => {
    await setLocale(page, 'he');
    // The gap is selected (DS3-04: its decision bar is under its evidence).
    await page.goto(`/dashboard/approvals?sel=${fx.c}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.c);
    // A manager escalates it to the owner underneath the open page.
    const sql = e2eSql();
    try {
      await sql`update discrepancies set resolution_status = 'escalated', requires_role = 'owner' where id = ${fx.c}`;
    } finally {
      await sql.end();
    }
    await page.getByTestId('decide-approve').click();
    // The CONFLICT returns the selection to the gap, its note in the evidence pane (DS3-04).
    await expect(page.getByTestId('approvals-evidence-pane')).toContainText('הועבר אליך');
    await expect(ev(page)).toHaveAttribute('data-id', fx.c);
    await expect(page.getByTestId('decide-approve')).toBeEnabled();
    await page.getByTestId('decide-approve').click();
    await expect.poll(() => statuses([fx.c])).toEqual(['accepted']);
  });
});

// DS3-04: the third pane is dropped (SPEC §10.2): from 1280 px the desk has two panes, the decision bar under the
// documents.
test.describe('desktop 1536', () => {
  test.use({ viewport: { width: 1536, height: 900 } });
  test('documents and decision beside the queue', async ({ page }) => {
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
    // RTL: the list at the start (right), the document beside it; the decision bar sits under the documents.
    expect(list!.x).toBeGreaterThan(d!.x);
    expect(k!.y).toBeGreaterThan(d!.y);
  });
});

test.describe('phone 390', () => {
  test.use({ viewport: PHONE, hasTouch: true });
  test('one gap at a time, no Peek', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto('/dashboard/approvals');
    // Narrow layout (DS3-04): the evidence of one gap is on the page itself, no Peek dialog, no rows.
    await expect(ev(page)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('approval-row').first()).toBeHidden();
    expect(new URL(page.url()).pathname).toBe('/dashboard/approvals');
  });

  test('the [invoiceId] landing: one gap, the stacked pair in the bottom third', async ({ page }) => {
    await setLocale(page, 'he');
    await page.goto(`/dashboard/approvals/${fx.inv.a}`);
    // Single mode (DS3-04): one gap's evidence.
    await expect(page.getByTestId('approval-evidence')).toHaveCount(1);
    const pair = page.getByTestId('decide-pair');
    const ap = await pair.getByTestId('decide-approve').boundingBox();
    const rj = await pair.getByTestId('decide-reject').boundingBox();
    expect(ap!.height).toBeGreaterThanOrEqual(48);
    expect(Math.abs(ap!.width - rj!.width)).toBeLessThan(2);
    expect(ap!.y).toBeGreaterThan((PHONE.height * 2) / 3 - ap!.height);
    await pair.getByTestId('decide-approve').click();
    await expect.poll(async () => (await statuses(fx.a)).filter((s) => s === 'accepted').length).toBe(1);
    // The next gap slides up in its place.
    await expect(page.getByTestId('approval-evidence')).toHaveCount(1);
  });
});

/**
 * #418 regression guard: the desk hydrates without a server/client mismatch when
 * the browser is in another time zone than the server (dates render in Israel
 * time; `useMediaQuery` hydrates from its server snapshot), on every desk route.
 */
for (const timezoneId of ['Asia/Jerusalem', 'America/New_York']) {
  for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', PHONE]] as const) {
    test.describe(`no hydration mismatch · ${timezoneId} · ${label}`, () => {
      test.use({ timezoneId, viewport });
      test('queue, ?invoice=, ?sel= and the [invoiceId] landing hydrate cleanly (he + en)', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (m) => {
          if (m.type() === 'error' && /hydrat|#418|#423|#425|did not match/i.test(m.text())) errors.push(m.text());
        });
        page.on('pageerror', (e) => {
          if (/hydrat|#418|#423|#425|did not match/i.test(String(e))) errors.push(String(e));
        });
        for (const locale of ['he', 'en'] as const) {
          await setLocale(page, locale);
          for (const route of [
            '/dashboard/approvals',
            `/dashboard/approvals?invoice=${fx.inv.a}`,
            `/dashboard/approvals?sel=${fx.a[0]}`,
            `/dashboard/approvals/${fx.inv.a}`,
          ]) {
            await page.goto(route);
            // DS3-04 renamed the gap's body: `approval-evidence` (one gap at a time below 1280 px, rows beside it above).
            await expect(page.getByTestId('approval-evidence').first()).toBeVisible();
          }
        }
        expect(errors).toEqual([]);
      });
    });
  }
}

test.describe('manager: escalation sheet → an outbox row per owner', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });
  test('note chips, then a queued e-mail with ₪ and the go-link; the escalator keeps the row', async ({ page }) => {
    await setLocale(page, 'he');
    await loginViaMagicLink(page, 'manager@kfar-hazeitim.test', `/dashboard/approvals?sel=${fx.c}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.c);
    // The ⋯ menu is gone (DS3-04): escalation is the decision bar's quiet action.
    await page.getByTestId('decide-escalate').click();
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
