import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql } from './helpers';

/**
 * DS3-04 · the approvals desk (spec §7.3), on the seeded demo owner (the manager signs in with its seeded password:
 * this file sorts before G-* / W* and spends no magic link).
 *
 * Fixture (`rule_id 'e2e-DS3-04'`, invoices `DS304-*`, the demo restaurant's first supplier by name), created and
 * removed here; every scenario opens `?invoice=<id>` or `?sel=<id>`, so positions and J/K neighbours are its own:
 *   DS304-A · due 12 h ago (after W1-07's "1 day ago": leftovers never pass for W1-07's fixture), 1057.00 / 1247.26,
 *             a PO (PO-DS304) of flour 5 שק @ 96.00 and feta 8 ק״ג @ 41.50, a closed receipt of 5 ק״ג feta, a scan;
 *             A1 PRICE_HIGHER block Δ147.00 (flour 96 → 125.40) and A2 QTY_OVER block Δ124.50 (8 billed, 5 received);
 *   DS304-C · total 100 / 118: C1 PRICE_HIGHER warn Δ150, its claim capped at 118.00;
 *   DS304-R · RV1 QTY_SHORT info Δ12 (not claimable: "סמנו כנבדק");
 *   DS304-M · M1 PRICE_HIGHER warn Δ20, routed to the manager;
 *   DS304-E · E1 Δ30 + E2 Δ15 PRICE_HIGHER warn (₪45 ≤ the ₪200 cap: "approve the whole invoice");
 *   DS304-V · subtotal 1000.00, printed VAT 178.30: V1 VAT_MISMATCH warn Δ1.70 (180.00 by the rate) and V2
 *             PRICE_HIGHER warn Δ10.
 *
 * Clock (P7): Playwright's clock keeps running after install() until it is paused. Timed scenarios install it before
 * the page loads and pause it once the desk has hydrated; tRPC's batch link sends from a setTimeout, so every request
 * is released with runFor(1) and then awaited (`flush`). While paused, Date.now() stands still: the 350 ms
 * double-activation guard needs runFor(400) between two decisions.
 *
 * Every test runs in a fresh browser context (Playwright's default), so no localStorage key or cookie a test set
 * (rm:keys:single, rm:density, rm_density) reaches the next one.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const TAG = 'e2e-DS3-04';
const MANAGER = 'manager@kfar-hazeitim.test';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

test.use({ storageState: OWNER_STATE, viewport: DESKTOP });

type Gap = 'A1' | 'A2' | 'C1' | 'RV1' | 'M1' | 'E1' | 'E2' | 'V1' | 'V2';
interface Fx {
  supplier: string;
  inv: Record<'A' | 'C' | 'R' | 'M' | 'E' | 'V', string>;
  gap: Record<Gap, string>;
}
let fx: Fx;

type Sql = ReturnType<typeof e2eSql>;

/** Everything the fixture made, and what the decisions wrote, in FK order. */
async function cleanup(sql: Sql) {
  const gaps = sql`select id from discrepancies where rule_id = ${TAG}`;
  const invoices = sql`select id from invoices where invoice_number like 'DS304-%'`;
  await sql`delete from recovery_events where claim_id in (
    select id from recovery_claims where discrepancy_id in (${gaps}) or invoice_id in (${invoices}))`;
  await sql`delete from recovery_claims where discrepancy_id in (${gaps}) or invoice_id in (${invoices})`;
  await sql`delete from notifications_outbox where related_entity_id in (${gaps})`;
  await sql`delete from activity_events where entity_id in (${gaps})`;
  await sql`delete from audit_log where entity_id in (${gaps})`;
  await sql`delete from discrepancies where rule_id = ${TAG}`;
  await sql`delete from match_runs where invoice_id in (${invoices})`;
  await sql`delete from invoice_scans where invoice_id in (${invoices})`;
  await sql`delete from invoice_lines where invoice_id in (${invoices})`;
  await sql`delete from invoices where invoice_number like 'DS304-%'`;
  await sql`delete from gr_lines where gr_id in (select id from goods_receipts where notes = ${TAG})`;
  await sql`delete from goods_receipts where notes = ${TAG}`;
  await sql`delete from po_lines where po_id in (select id from purchase_orders where notes = ${TAG})`;
  await sql`delete from purchase_orders where notes = ${TAG}`;
}

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    await cleanup(sql); // a crashed run's leftovers
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    const rid = r!.id;
    const [sup] = await sql<{ id: string; name: string }[]>`
      select id, name from suppliers where restaurant_id = ${rid} order by name limit 1`;
    const invoice = async (n: string, due: string, excl: number, incl: number, vat: number | null = null) => {
      const [inv] = await sql<{ id: string }[]>`
        insert into invoices (restaurant_id, supplier_id, invoice_number, invoice_date, due_date, total_excl_vat, vat_amount,
          total_incl_vat, status, source)
        values (${rid}, ${sup!.id}, ${n}, now() - interval '5 days', now() + ${due}::interval, ${excl}, ${vat}, ${incl},
          'matched', 'manual')
        returning id`;
      return inv!.id;
    };
    const line = async (inv: string, item: string, qty: number, unit: string, price: number, total: number) => {
      const [l] = await sql<{ id: string }[]>`
        insert into invoice_lines (invoice_id, raw_description, qty_billed, unit, unit_price_billed, line_total)
        values (${inv}, ${item}, ${qty}, ${unit}, ${price}, ${total}) returning id`;
      return l!.id;
    };
    const run = async (inv: string, status: string, po: string | null = null, gr: string | null = null) => {
      const [m] = await sql<{ id: string }[]>`
        insert into match_runs (restaurant_id, invoice_id, po_id, gr_id, overall_status, total_discrepancy_amount)
        values (${rid}, ${inv}, ${po}, ${gr}, ${status}, 0) returning id`;
      return m!.id;
    };
    const gap = async (
      mr: string,
      type: string,
      severity: 'block' | 'warn' | 'info',
      delta: number,
      o: { exp?: number; act?: number; tol?: string; il?: string; pl?: string; gl?: string; role?: string },
    ) => {
      const [d] = await sql<{ id: string }[]>`
        insert into discrepancies (match_run_id, restaurant_id, type, severity, delta_amount, expected_value, actual_value,
          tolerance_used, requires_role, resolution_status, invoice_line_id, po_line_id, gr_line_id, rule_id)
        values (${mr}, ${rid}, ${type}, ${severity}, ${delta}, ${o.exp ?? null}, ${o.act ?? null}, ${o.tol ?? null},
          ${o.role ?? 'owner'}, 'open', ${o.il ?? null}, ${o.pl ?? null}, ${o.gl ?? null}, ${TAG})
        returning id`;
      return d!.id;
    };
    const PRICE_TOL = 'price: ±2% or ₪5';

    // DS304-A: the three-way table (order, receipt, invoice) behind two blocking gaps.
    const [po] = await sql<{ id: string }[]>`
      insert into purchase_orders (restaurant_id, supplier_id, status, source, source_ref, sent_at, notes)
      values (${rid}, ${sup!.id}, 'sent', 'manual', 'PO-DS304', now() - interval '10 days', ${TAG}) returning id`;
    const [plFlour] = await sql<{ id: string }[]>`
      insert into po_lines (po_id, raw_description, qty_ordered, unit, unit_price_expected)
      values (${po!.id}, 'קמח לבן', 5, 'שק', 96.00) returning id`;
    const [plFeta] = await sql<{ id: string }[]>`
      insert into po_lines (po_id, raw_description, qty_ordered, unit, unit_price_expected)
      values (${po!.id}, 'גבינת פטה', 8, 'ק״ג', 41.50) returning id`;
    const [gr] = await sql<{ id: string }[]>`
      insert into goods_receipts (restaurant_id, po_id, received_at, status, notes)
      values (${rid}, ${po!.id}, now() - interval '6 days', 'completed', ${TAG}) returning id`;
    const [glFeta] = await sql<{ id: string }[]>`
      insert into gr_lines (gr_id, po_line_id, qty_received) values (${gr!.id}, ${plFeta!.id}, 5) returning id`;
    const invA = await invoice('DS304-A', '-12 hours', 1057.0, 1247.26, 190.26);
    await line(invA, 'בצל יבש', 25, 'ק״ג', 3.92, 98.0);
    const ilFeta = await line(invA, 'גבינת פטה', 8, 'ק״ג', 41.5, 332.0);
    const ilFlour = await line(invA, 'קמח לבן', 5, 'שק', 125.4, 627.0);
    // A scan, so the evidence offers its photo disclosure (scenario 11).
    await sql`insert into invoice_scans (invoice_id, restaurant_id, storage_path, mime_type)
      values (${invA}, ${rid}, ${`e2e/${TAG}/DS304-A.jpg`}, 'image/jpeg')`;
    const mrA = await run(invA, 'blocked', po!.id, gr!.id);
    const A1 = await gap(mrA, 'PRICE_HIGHER', 'block', 147.0, { exp: 96, act: 125.4, tol: PRICE_TOL, il: ilFlour, pl: plFlour!.id });
    const A2 = await gap(mrA, 'QTY_OVER', 'block', 124.5, {
      exp: 5,
      act: 8,
      tol: 'billed quantity exceeds received quantity',
      il: ilFeta,
      pl: plFeta!.id,
      gl: glFeta!.id,
    });

    const invC = await invoice('DS304-C', '30 days', 100, 118);
    const C1 = await gap(await run(invC, 'major'), 'PRICE_HIGHER', 'warn', 150, {
      exp: 10,
      act: 25,
      tol: PRICE_TOL,
      il: await line(invC, 'סוכר לבן', 10, 'יח׳', 25, 250),
    });

    const invR = await invoice('DS304-R', '20 days', 500, 590);
    const RV1 = await gap(await run(invR, 'minor'), 'QTY_SHORT', 'info', 12, {
      exp: 3,
      act: 2,
      il: await line(invR, 'ביצים L', 2, 'תבנית', 12, 24),
    });

    const invM = await invoice('DS304-M', '20 days', 300, 354);
    const M1 = await gap(await run(invM, 'major'), 'PRICE_HIGHER', 'warn', 20, {
      exp: 4,
      act: 6,
      tol: PRICE_TOL,
      il: await line(invM, 'חלב 3%', 10, 'ליטר', 6, 60),
      role: 'manager',
    });

    const invE = await invoice('DS304-E', '20 days', 2000, 2360);
    const ilOil = await line(invE, 'שמן קנולה', 3, 'ליטר', 20, 60);
    const ilSalt = await line(invE, 'מלח גס', 5, 'ק״ג', 5, 25);
    const mrE = await run(invE, 'major');
    const E1 = await gap(mrE, 'PRICE_HIGHER', 'warn', 30, { exp: 10, act: 20, tol: PRICE_TOL, il: ilOil });
    const E2 = await gap(mrE, 'PRICE_HIGHER', 'warn', 15, { exp: 2, act: 5, tol: PRICE_TOL, il: ilSalt });

    const invV = await invoice('DS304-V', '20 days', 1000.0, 1178.3, 178.3);
    const ilCoffee = await line(invV, 'קפה טחון', 5, 'יח׳', 22, 110);
    await line(invV, 'שמן זית', 10, 'ליטר', 89, 890);
    const mrV = await run(invV, 'major');
    const V1 = await gap(mrV, 'VAT_MISMATCH', 'warn', 1.7, { exp: 180.0, act: 178.3, tol: '18% VAT on subtotal, ±₪1' });
    const V2 = await gap(mrV, 'PRICE_HIGHER', 'warn', 10, { exp: 20, act: 22, tol: PRICE_TOL, il: ilCoffee });

    fx = {
      supplier: sup!.name,
      inv: { A: invA, C: invC, R: invR, M: invM, E: invE, V: invV },
      gap: { A1, A2, C1, RV1, M1, E1, E2, V1, V2 },
    };
  } finally {
    await sql.end();
  }
});

test.beforeEach(async ({ context }) => {
  const sql = e2eSql();
  try {
    const gaps = sql`select id from discrepancies where rule_id = ${TAG}`;
    await sql`delete from recovery_events where claim_id in (select id from recovery_claims where discrepancy_id in (${gaps}))`;
    await sql`delete from recovery_claims where discrepancy_id in (${gaps})`;
    await sql`delete from notifications_outbox where related_entity_id in (${gaps})`;
    await sql`delete from activity_events where entity_id in (${gaps})`;
    await sql`delete from audit_log where entity_id in (${gaps})`;
    await sql`
      update discrepancies set resolution_status = 'open', resolved_by = null, resolved_at = null, resolution_note = null,
        requires_role = case when id = ${fx.gap.M1} then 'manager'::user_role else 'owner'::user_role end
      where rule_id = ${TAG}`;
  } finally {
    await sql.end();
  }
  await setCookies(context, 'he');
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await cleanup(sql);
  } finally {
    await sql.end();
  }
});

/* ───────────────────────────── helpers ───────────────────────────── */

async function setCookies(context: BrowserContext, locale: 'he' | 'en', extra: { name: string; value: string }[] = []) {
  const url = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
    ...extra.map((c) => ({ ...c, url })),
  ]);
}

/** The seeded demo password through Auth.js's own endpoints (W1-04:26-39): no magic link, no extra member. */
async function signIn(page: Page, email: string): Promise<void> {
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email, password: PASSWORD, rememberMe: 'false', csrfToken: csrf.csrfToken, callbackUrl: '/dashboard' },
    maxRedirects: 0,
  });
  expect(res.status(), `password sign-in for ${email}`).toBeLessThan(400);
}

interface Call {
  path: string;
  input: unknown;
}
/** Every tRPC POST (`/api/trpc/<a,b>?batch=1`, superjson `{"0":{"json":…}}`) as `{path, input}`, in order. */
function recordTrpc(page: Page): Call[] {
  const calls: Call[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/api/trpc/')) return;
    const paths = decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');
    let body: Record<string, { json?: unknown }> = {};
    try {
      body = JSON.parse(req.postData() ?? '{}') as typeof body;
    } catch {
      /* not a JSON batch */
    }
    paths.forEach((path, i) => calls.push({ path, input: body[String(i)]?.json }));
  });
  return calls;
}
const DECISIONS = ['approve', 'reject', 'escalate', 'decideMany', 'reopen', 'reopenMany'].map((p) => `approvals.${p}`);
/** The decision calls (approve / reject / escalate / decideMany / reopen / reopenMany) among the recorded ones. */
const decisions = (calls: Call[]) => calls.filter((c) => DECISIONS.includes(c.path));
const DECISION_RE = /\/api\/trpc\/[^?]*approvals\.(approve|reject|escalate|decideMany|reopen|reopenMany)\b/;

/** A clocked page: release the batch link's setTimeout, then wait for the decision's response. */
async function flush(page: Page, re: RegExp = DECISION_RE) {
  const response = page.waitForResponse((r) => re.test(r.url()));
  await page.clock.runFor(1);
  await response;
}
/** A page on the real clock: do it and wait for the decision's response. */
async function sent(page: Page, act: () => Promise<unknown>, re: RegExp = DECISION_RE) {
  const response = page.waitForResponse((r) => re.test(r.url()));
  await act();
  await response;
}
/** Nothing new was sent: a key that must not decide, given half a second (and the batch link's tick when clocked). */
async function noNewDecision(page: Page, calls: Call[], count: number, clocked = false) {
  if (clocked) await page.clock.runFor(1);
  await page.waitForTimeout(500);
  expect(decisions(calls)).toHaveLength(count);
}

const cell = (p: Page, id: string) => p.locator(`[data-row-id="${id}"]`);
const row = (p: Page, id: string) => p.locator(`[data-testid="approval-row"][data-id="${id}"]`);
const ev = (p: Page) => p.getByTestId('approval-evidence');
const toast = (p: Page) => p.getByTestId('approvals-undo');

/** Without the bidi isolates and marks (U+2066-2069, U+200E, U+200F), spaces (NBSP included) as one space. */
const plain = (text: string | null) =>
  (text ?? '')
    .replace(/[⁦-⁩‎‏]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function notBody(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.activeElement != null && document.activeElement !== document.body))
    .toBe(true);
}

/** The desk has hydrated: React's fiber sits on its last control (polled from the runner, any clock state). */
async function hydrated(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector('[data-testid="decision-bar"]') ?? document.querySelector('[data-desk]');
        return el != null && Object.keys(el).some((k) => k.startsWith('__reactFiber'));
      }),
    )
    .toBe(true);
  await page.waitForTimeout(150);
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(ev(page)).toBeVisible();
  await hydrated(page);
}

/** The clock rule (P7): installed before the page loads, paused once the desk has hydrated. */
async function openClocked(page: Page, url: string) {
  const t0 = Date.now();
  await page.clock.install({ time: t0 });
  await open(page, url);
  await page.clock.pauseAt(t0 + 60_000);
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b, 'rendered').not.toBeNull();
  return b!;
}

/** `data-undo-left-ms` is within ± 1 000 of `ms` (it updates once a second). */
async function expectLeft(t: Locator, ms: number) {
  await expect.poll(async () => Math.abs(Number(await t.getAttribute('data-undo-left-ms')) - ms)).toBeLessThanOrEqual(1_000);
}

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

const approveOf = (id: string, seenClaimAgorot: number) => ({
  path: 'approvals.approve',
  input: { discrepancyId: id, expectedStatus: 'open', seenClaimAgorot },
});

/* ───────────────────────────── 1 · keys ───────────────────────────── */

test.describe('1 · keys honour the preference and never fire while typing', () => {
  test('a · J/K move with the URL; 1 claims with the same input; Z reopens', async ({ page }) => {
    const calls = recordTrpc(page);
    await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    await cell(page, fx.gap.A1).focus();
    await page.keyboard.press('KeyJ');
    await expect(cell(page, fx.gap.A2)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]sel=${fx.gap.A2}`));
    await page.keyboard.press('KeyK');
    await expect(cell(page, fx.gap.A1)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]sel=${fx.gap.A1}`));
    await sent(page, () => page.keyboard.press('Digit1'));
    await expect(cell(page, fx.gap.A2)).toBeFocused();
    await expect(toast(page)).toBeVisible();
    await sent(page, () => page.keyboard.press('KeyZ'));
    expect(decisions(calls)).toEqual([approveOf(fx.gap.A1, 14_700), { path: 'approvals.reopen', input: { discrepancyId: fx.gap.A1 } }]);
  });

  test('b · keys off (stored before the load): J does nothing, the arrows move, 1 never decides, caps and legend say so', async ({ page }) => {
    const calls = recordTrpc(page);
    await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('rm:keys:single', '0');
      } catch {
        /* blocked storage: the test fails on the caps below */
      }
    });
    await page.reload();
    await expect(ev(page)).toBeVisible();
    await hydrated(page);
    const approve = page.getByTestId('decide-approve');
    await expect(approve).not.toHaveAttribute('aria-keyshortcuts');
    await expect(approve.locator('[data-kbd]')).toHaveCount(0);
    await expect(page.locator('#desk-keys-sr')).toHaveText('החצים עוברים בין הפערים');
    await expect(page.getByTestId('desk-keys-legend')).toContainText('קיצורים בתו אחד כבויים, החצים עוברים בין הפערים');
    await cell(page, fx.gap.A1).focus();
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(300);
    await expect(cell(page, fx.gap.A1)).toBeFocused();
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, fx.gap.A2)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]sel=${fx.gap.A2}`));
    await page.keyboard.press('Digit1');
    await noNewDecision(page, calls, 0);
  });

  test('b′ · the store\'s own event turns the caps off and back on without a reload', async ({ page }) => {
    await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    const approve = page.getByTestId('decide-approve');
    await expect(approve).toHaveAttribute('aria-keyshortcuts', '1');
    await expect(approve.locator('[data-kbd]')).toHaveCount(1);
    await page.evaluate(() => {
      localStorage.setItem('rm:keys:single', '0');
      window.dispatchEvent(new Event('rm:keys'));
    });
    await expect(approve).not.toHaveAttribute('aria-keyshortcuts');
    await expect(approve.locator('[data-kbd]')).toHaveCount(0);
    await cell(page, fx.gap.A1).focus();
    await page.keyboard.press('KeyJ');
    await page.waitForTimeout(300);
    await expect(cell(page, fx.gap.A1)).toBeFocused();
    await page.evaluate(() => {
      localStorage.setItem('rm:keys:single', '1');
      window.dispatchEvent(new Event('rm:keys'));
    });
    await expect(approve).toHaveAttribute('aria-keyshortcuts', '1');
    await expect(approve.locator('[data-kbd]')).toHaveCount(1);
    await page.keyboard.press('KeyJ');
    await expect(cell(page, fx.gap.A2)).toBeFocused();
  });

  test('c · 2 opens the reasons; typing "1j2z" in "אחר" fires no key; Escape returns to the row', async ({ page }) => {
    const calls = recordTrpc(page);
    await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    await cell(page, fx.gap.A1).focus();
    await page.keyboard.press('Digit2');
    const reasons = page.getByTestId('waive-reasons');
    await expect(reasons).toBeVisible();
    await reasons.getByRole('button', { name: 'אחר', exact: true }).click();
    const text = reasons.locator('textarea');
    await expect(text).toBeFocused();
    await page.keyboard.type('1j2z');
    await expect(text).toHaveValue('1j2z');
    await noNewDecision(page, calls, 0);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
    await page.keyboard.press('Escape');
    await expect(reasons).toHaveCount(0);
    await expect(cell(page, fx.gap.A1)).toBeFocused();
  });

  test('d · the caps on the bar act: 1 on "שלמו כפי שחויב" claims, focus to the next primary, Z there reopens', async ({ page }) => {
    const calls = recordTrpc(page);
    await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    await page.getByTestId('decide-reject').focus();
    await sent(page, () => page.keyboard.press('Digit1'));
    expect(decisions(calls)).toEqual([approveOf(fx.gap.A1, 14_700)]);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);
    await expect(page.getByTestId('decide-approve')).toBeFocused();
    await expect(toast(page)).toBeVisible();
    await sent(page, () => page.keyboard.press('KeyZ'));
    expect(decisions(calls)).toEqual([approveOf(fx.gap.A1, 14_700), { path: 'approvals.reopen', input: { discrepancyId: fx.gap.A1 } }]);
  });
});

/* ───────────────────────────── 2 · modifiers, repeat, double activation ───────────────────────────── */

test('2 · Shift, modifiers and a held key never decide; a held J moves; two 1s 100 ms apart decide once', async ({ page }) => {
  const calls = recordTrpc(page);
  await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
  const a1 = cell(page, fx.gap.A1);
  await a1.focus();
  for (const key of ['Shift+Digit1', 'Control+Digit1', 'Alt+Digit1']) await page.keyboard.press(key);
  await a1.dispatchEvent('keydown', { code: 'Digit1', key: '1', repeat: true, bubbles: true });
  await noNewDecision(page, calls, 0);
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
  await a1.dispatchEvent('keydown', { code: 'KeyJ', key: 'j', repeat: true, bubbles: true });
  await expect(cell(page, fx.gap.A2)).toBeFocused();
  await page.keyboard.press('KeyK');
  await expect(a1).toBeFocused();
  // The second 1 lands on the next gap's row (focus moved there): the 350 ms guard keeps it from deciding it.
  await sent(page, async () => {
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(100);
    await page.keyboard.press('Digit1');
  });
  await noNewDecision(page, calls, 1);
  expect(decisions(calls)).toEqual([approveOf(fx.gap.A1, 14_700)]);
});

/* ───────────────────────────── 3 · the undo toast's time ───────────────────────────── */

test.describe('3 · the 10 s line and the 12 s cap', () => {
  test('visible for 10 s; hovered it holds, yet the 12 s cap ends it; Z after the cap reopens nothing', async ({ page }) => {
    const calls = recordTrpc(page);
    await openClocked(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    const t = toast(page);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
    await page.getByTestId('decide-approve').click();
    await flush(page);
    await expect(t).toHaveAttribute('data-undo-state', 'running');
    await page.clock.runFor(5_000);
    await expectLeft(t, 5_000);
    await page.clock.runFor(4_000); // 9 s
    await expect(t).toBeVisible();
    await page.clock.runFor(1_500); // 10.5 s
    await expect(t).toHaveCount(0);

    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);
    await page.getByTestId('decide-approve').click();
    await flush(page);
    await expect(t).toHaveAttribute('data-undo-state', 'running');
    await t.hover();
    await expect(t).toHaveAttribute('data-undo-state', 'paused');
    const held = Number(await t.getAttribute('data-undo-left-ms'));
    // Hovered, the 10 s window holds…
    await page.clock.runFor(2_000);
    await expectLeft(t, held);
    // …but the cap wins while paused (§2.3 undoLeftMs = min(paused ? now + remaining : endsAt, capAt) − now, §5.5): at
    // 6 s after sending the time left is the cap's 6 s, not the held 10 s.
    await page.clock.runFor(4_000);
    await expectLeft(t, 6_000);
    await expect(t).toHaveAttribute('data-undo-state', 'paused');
    await page.clock.runFor(5_000); // 11 s after sending
    await expect(t).toBeVisible();
    await page.clock.runFor(1_500); // 12.5 s: sent + 12 s, while hovered
    await expect(t).toHaveCount(0);
    // A done row lives exactly as long as its undo: after the cap DS304-A has no row left, and focus is on the desk's
    // empty state (the last decision's target). Z there reopens nothing.
    const sent0 = decisions(calls).length;
    await expect(page.locator('[data-desk-empty]')).toBeFocused();
    await page.keyboard.press('KeyZ');
    await noNewDecision(page, calls, sent0, true);
    expect(decisions(calls).filter((c) => c.path === 'approvals.reopen')).toEqual([]);
  });

  test('reduced motion: the line steps from data-undo-left-ms with no animation; the undo button has the white ring', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openClocked(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    const t = toast(page);
    await page.getByTestId('decide-approve').click();
    await flush(page);
    await expect(t).toHaveAttribute('data-undo-state', 'running');
    await page.clock.runFor(3_000);
    const line = page.getByTestId('undo-line');
    await expect
      .poll(async () => {
        const left = Number(await t.getAttribute('data-undo-left-ms'));
        const transform = await line.evaluate((el) => (el as HTMLElement).style.transform);
        return left <= 7_500 && transform === `scaleX(${Math.ceil(left / 1000) / 10})`;
      })
      .toBe(true);
    expect(await line.evaluate((el) => el.getAnimations().length)).toBe(0);
    const button = page.getByTestId('approvals-undo-button');
    for (let i = 0; i < 8 && !(await button.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(255, 255, 255)');
  });
});

/* ───────────────────────────── 4 · the next gap ───────────────────────────── */

test('4 · the next gap arrives: evidence and URL, the done row, the head, the announcer, focus by how it was decided', async ({ page }) => {
  await openClocked(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
  const head = page.getByTestId('approvals-summary-line');
  const count = Number(await head.getAttribute('data-count'));
  expect(count).toBe(2);
  await page.getByTestId('decide-approve').click();
  await flush(page);
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);
  await expect(page).toHaveURL(new RegExp(`[?&]sel=${fx.gap.A2}`));
  await expect(row(page, fx.gap.A1)).toHaveAttribute('data-state', 'done');
  await expect(row(page, fx.gap.A1)).toContainText('נוסף לבקשת הזיכוי');
  await expect(head).toHaveAttribute('data-count', String(count - 1));
  const sr = page.getByTestId('approvals-announcer');
  for (const words of ['נוסף לבקשת הזיכוי', 'לפני מע״מ', 'נותר פער אחד', 'הבא:']) await expect(sr).toContainText(words);
  await expect(cell(page, fx.gap.A2)).toBeFocused();
  await notBody(page);

  // Undo; the bar's claim by keyboard (Enter) → focus on the next gap's primary.
  await page.getByTestId('approvals-undo-button').click();
  await flush(page);
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
  await page.clock.runFor(400); // past the double-activation guard (Date.now() stands still while paused)
  await page.getByTestId('decide-approve').focus();
  await page.keyboard.press('Enter');
  await flush(page);
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);
  await expect(page.getByTestId('decide-approve')).toBeFocused();

  // Undo; 1 in the rows → focus on the next row's cell.
  await page.getByTestId('approvals-undo-button').click();
  await flush(page);
  await expect(cell(page, fx.gap.A1)).toBeFocused();
  await page.clock.runFor(400);
  await page.keyboard.press('Digit1');
  await flush(page);
  await expect(cell(page, fx.gap.A2)).toBeFocused();
  await page.clock.runFor(13_000);
  await expect(row(page, fx.gap.A1)).toHaveCount(0);
});

/* ───────────────────────────── 5 · the reasons row ───────────────────────────── */

test('5 · the reasons row says what paying costs; its chips decide only their own gap', async ({ page }) => {
  const calls = recordTrpc(page);
  await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
  await cell(page, fx.gap.A2).click();
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);
  await page.getByTestId('decide-reject').click();
  const cost = page.getByTestId('desk-cost-line');
  await expect(cost).toContainText(fx.supplier);
  await expect(cost).toContainText('לפני מע״מ');
  await expect(cost).toContainText('על 3 ק״ג שלא התקבלו');
  await expect(page.locator('[data-reason-chip]').first()).toBeFocused();
  await page.keyboard.press('Digit1');
  await noNewDecision(page, calls, 0);
  await sent(page, () => page.getByRole('button', { name: 'הגיע בפועל, הקבלה שגויה' }).click());
  expect(decisions(calls)).toEqual([
    { path: 'approvals.reject', input: { discrepancyId: fx.gap.A2, reason: 'הגיע בפועל, הקבלה שגויה', reasonCode: 'received_actual' } },
  ]);
  await sent(page, () => page.getByTestId('approvals-undo-button').click());
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);

  // "אחר" + its text + confirm.
  await page.getByTestId('decide-reject').click();
  const reasons = page.getByTestId('waive-reasons');
  await reasons.getByRole('button', { name: 'אחר', exact: true }).click();
  await reasons.locator('textarea').fill('בדיקה');
  await sent(page, () => reasons.getByRole('button', { name: 'שלמו כפי שחויב' }).click());
  expect(decisions(calls).slice(2)).toEqual([
    { path: 'approvals.reject', input: { discrepancyId: fx.gap.A2, reason: 'בדיקה', reasonCode: 'other' } },
  ]);
  await sent(page, () => page.getByTestId('approvals-undo-button').click());
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);

  // R9: the reasons belong to one gap; another gap's row closes them.
  await page.getByTestId('decide-reject').click();
  await expect(reasons).toBeVisible();
  await cell(page, fx.gap.A1).click();
  await expect(reasons).toHaveCount(0);
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
  await page.getByTestId('decide-reject').click();
  await expect(cost).toContainText('מעל המחיר שבהזמנה');
  await page.getByTestId('reasons-back').click();
  await expect(page.getByTestId('decide-reject')).toBeFocused();
  await noNewDecision(page, calls, 4);
});

/* ───────────────────────────── 6 · the same procedures ───────────────────────────── */

test.describe('6 · every decision calls the same procedure with the same input', () => {
  test('owner: a capped claim, a review, the invoice with a blocker, the whole invoice at once', async ({ page }) => {
    const calls = recordTrpc(page);
    await open(page, `/dashboard/approvals?sel=${fx.gap.C1}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.C1);
    await expect(page.getByTestId('decide-approve')).toHaveAccessibleName(/בקשת זיכוי · .*118\.00/);
    const note = page.getByTestId('desk-claim-note');
    for (const words of ['118.00', '150.00', 'לפני מע״מ']) await expect(note).toContainText(words);
    await sent(page, () => page.getByTestId('decide-approve').click());
    expect(decisions(calls)).toEqual([approveOf(fx.gap.C1, 11_800)]);

    await open(page, `/dashboard/approvals?sel=${fx.gap.RV1}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.RV1);
    const review = page.getByTestId('decide-review');
    await expect(review).toHaveAccessibleName('סמנו כנבדק');
    await sent(page, () => review.click());
    expect(decisions(calls).slice(1)).toEqual([
      { path: 'approvals.reject', input: { discrepancyId: fx.gap.RV1, reason: 'סמנו כנבדק', reasonCode: 'reviewed' } },
    ]);

    await open(page, `/dashboard/approvals?sel=${fx.gap.A1}`);
    await expect(ev(page).getByTestId('group-why')).toBeVisible();
    await expect(ev(page).getByTestId('group-approve')).toHaveCount(0);

    // The whole invoice: optimistic (R11) — both rows are done before the server answers.
    await open(page, `/dashboard/approvals?invoice=${fx.inv.E}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.E1);
    let answered = false;
    page.on('response', (r) => {
      if (r.url().includes('approvals.decideMany')) answered = true;
    });
    await page.route('**/api/trpc/approvals.decideMany**', (r) => {
      setTimeout(() => void r.continue(), 1_000);
    });
    await ev(page).getByTestId('group-approve').click();
    await expect(row(page, fx.gap.E1)).toHaveAttribute('data-state', 'done', { timeout: 900 });
    await expect(row(page, fx.gap.E2)).toHaveAttribute('data-state', 'done', { timeout: 900 });
    expect(answered, 'the rows were done before decideMany answered').toBe(false);
    await expect.poll(() => answered).toBe(true);
    expect(decisions(calls).slice(2)).toEqual([
      {
        path: 'approvals.decideMany',
        input: {
          items: [
            { discrepancyId: fx.gap.E1, expectedStatus: 'open' },
            { discrepancyId: fx.gap.E2, expectedStatus: 'open' },
          ],
          decision: 'accepted',
          clientMutationId: expect.stringMatching(/^.{8,64}$/),
        },
      },
    ]);
    await expect.poll(async () => plain(await toast(page).locator('p').textContent())).toBe('אושרו 2 פערים · 45.00 ₪ לפני מע״מ');
    await sent(page, () => page.getByTestId('approvals-undo-button').click());
    expect(decisions(calls).slice(3)).toEqual([
      { path: 'approvals.reopenMany', input: { discrepancyIds: [fx.gap.E1, fx.gap.E2] } },
    ]);
  });

  test.describe('the manager', () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test('escalates with the bar\'s quiet action: approvals.escalate with the chip as its note', async ({ page }) => {
      await signIn(page, MANAGER);
      const calls = recordTrpc(page);
      await open(page, `/dashboard/approvals?sel=${fx.gap.M1}`);
      await expect(ev(page)).toHaveAttribute('data-id', fx.gap.M1);
      await page.getByTestId('decide-escalate').click();
      await page.getByRole('button', { name: 'מחיר חריג' }).click();
      await sent(page, () => page.getByTestId('escalate-send').click());
      expect(decisions(calls)).toEqual([{ path: 'approvals.escalate', input: { discrepancyId: fx.gap.M1, note: 'מחיר חריג' } }]);
    });
  });
});

/* ───────────────────────────── 7 · empty ───────────────────────────── */

test.describe('7 · the empty state', () => {
  test('desk: the last gap decided by keyboard → "הכול מטופל", filtered, a level-2 heading, focus on it', async ({ page }) => {
    await open(page, `/dashboard/approvals?invoice=${fx.inv.E}`);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.E1);
    await sent(page, () => page.getByTestId('decide-approve').click());
    await expect(cell(page, fx.gap.E2)).toBeFocused();
    await page.waitForTimeout(400); // past the double-activation guard
    await sent(page, () => page.keyboard.press('Digit1'));
    const head = page.getByTestId('approvals-summary-line');
    await expect(head).toHaveText('אין פערים פתוחים');
    await expect(head).toHaveAttribute('data-count', '0');
    const empty = page.getByTestId('approvals-empty');
    await expect(empty).toContainText('הכול מטופל');
    await expect(empty).toContainText('מוצג לפי הסינון');
    await expect(empty.locator('[role="heading"][aria-level="2"]')).toHaveCount(1);
    await expect(page.locator('[data-desk-empty]')).toBeFocused();
  });

  test.describe('the landing at 390', () => {
    test.use({ viewport: PHONE });
    test('the cap ends a focused toast: focus goes to "כל הפערים בחשבונית טופלו", never body', async ({ page }) => {
      await openClocked(page, `/dashboard/approvals/${fx.inv.E}`);
      await expect(ev(page)).toHaveAttribute('data-id', fx.gap.E1);
      await page.getByTestId('decide-approve').click();
      await flush(page);
      await expect(ev(page)).toHaveAttribute('data-id', fx.gap.E2);
      await page.clock.runFor(400); // past the double-activation guard
      await page.getByTestId('decide-approve').click();
      await flush(page);
      await page.getByTestId('approvals-undo-button').focus();
      await expect(page.getByTestId('approvals-undo-button')).toBeFocused();
      await page.clock.runFor(13_000);
      await expect(toast(page)).toHaveCount(0);
      const empty = page.getByTestId('approvals-empty');
      await expect(empty).toContainText('הכול מטופל');
      await expect(empty).toContainText('כל הפערים בחשבונית טופלו');
      await notBody(page);
      await expect(page.locator('[data-desk-empty]')).toBeFocused();
    });
  });
});

/* ───────────────────────────── 8 · narrow ───────────────────────────── */

/** The bottom nav's top (ChromeMetrics' rule: a fixed `nav` in the lower half), else the viewport's bottom. */
function bottomNavTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll<HTMLElement>('[data-rm-chrome="bottomnav"], body nav')].find((n) => {
      const r = n.getBoundingClientRect();
      return getComputedStyle(n).position === 'fixed' && r.height > 0 && r.top > window.innerHeight / 2;
    });
    return nav ? nav.getBoundingClientRect().top : window.innerHeight;
  });
}

test.describe('8 · narrow 390×844', () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true });
  test('one gap at a time: no rows, 44 px prev/next, 52 px decisions, the bar on the bottom nav, the toast in the bar', async ({ page }) => {
    await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    await expect(page.getByTestId('approval-row').first()).toBeHidden();
    await expect(page.locator('[data-testid="card-select"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-batchbar]:visible')).toHaveCount(0);
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
    const position = page.getByTestId('desk-position');
    await expect(position).toHaveText(/^1 מתוך 2/);
    const prev = page.getByTestId('desk-prev');
    await expect(prev).toBeDisabled();
    const p = await box(prev);
    expect(p.width).toBeGreaterThanOrEqual(44);
    expect(p.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('desk-next').click();
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);
    await expect(position).toHaveText(/^2 מתוך 2/);
    const buttons = page.locator('button[data-testid^="decide-"]:visible, a[data-testid^="decide-"]:visible');
    expect(await buttons.count()).toBeGreaterThanOrEqual(2);
    for (const b of await buttons.all()) {
      const bb = await box(b);
      expect(bb.height).toBeGreaterThanOrEqual(52);
      expect(bb.width).toBeGreaterThanOrEqual(0.8 * PHONE.width);
    }
    const bar = page.getByTestId('decision-bar');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(async () => {
        const b = await box(bar);
        return Math.abs(b.y + b.height - (await bottomNavTop(page)));
      })
      .toBeLessThanOrEqual(1);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    const scrolled = await box(bar);
    expect(scrolled.y).toBeGreaterThanOrEqual(0);
    expect(scrolled.y + scrolled.height).toBeLessThanOrEqual(PHONE.height);
    expect(scrolled.y + scrolled.height).toBeLessThanOrEqual((await bottomNavTop(page)) + 1);

    await page.getByTestId('decide-approve').click();
    await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A1);
    await expect(page.getByTestId('decide-approve')).toBeFocused();
    await notBody(page);
    await expect(bar.getByTestId('approvals-undo')).toBeVisible();
    const u = await box(bar.getByTestId('approvals-undo-button'));
    expect(u.width).toBeGreaterThanOrEqual(44);
    expect(u.height).toBeGreaterThanOrEqual(44);
    for (const k of await bar.locator('[data-kbd]').all()) await expect(k).toBeHidden();
    await expect(page.getByTestId('desk-next').locator('svg:visible')).toHaveClass(/(^|\s)rtl:-scale-x-100(\s|$)/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
  });
});

/* ───────────────────────────── 9 · density ───────────────────────────── */

test.describe('9 · density', () => {
  const rowHeight = async (page: Page) => (await box(page.getByTestId('approval-row').first())).height;
  const barMinHeight = (page: Page) => page.getByTestId('decision-bar').evaluate((el) => getComputedStyle(el).minHeight);

  test('1440: compact 43 px rows and a 60 px bar (regular 53 / 72); the cookie resolves on the server; the address wins', async ({ page, context }) => {
    const url = `/dashboard/approvals?invoice=${fx.inv.A}`;
    await open(page, `${url}&d=compact`);
    expect(Math.abs((await rowHeight(page)) - 43)).toBeLessThanOrEqual(1);
    expect(await barMinHeight(page)).toBe('60px');
    await open(page, `${url}&d=comfortable`);
    expect(Math.abs((await rowHeight(page)) - 53)).toBeLessThanOrEqual(1);
    expect(await barMinHeight(page)).toBe('72px');

    // The stored choice, no `d`: compact in the first HTML and after hydration (no switch).
    await setCookies(context, 'he', [{ name: 'rm_density', value: 'compact' }]);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('rm:density', 'compact');
      } catch {
        /* the cookie alone decides on the server */
      }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].every((l) => l.sheet != null),
    );
    const early = await rowHeight(page);
    await page.waitForLoadState('networkidle');
    await hydrated(page);
    const late = await rowHeight(page);
    expect(Math.abs(early - 43)).toBeLessThanOrEqual(1);
    expect(Math.abs(late - 43)).toBeLessThanOrEqual(1);
    expect(late).toBe(early);
    await open(page, `${url}&d=comfortable`);
    expect(Math.abs((await rowHeight(page)) - 53)).toBeLessThanOrEqual(1);
  });

  test.describe('390', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });
    test('compact never shrinks the phone: bar buttons ≥ 52, chips and "חזרה" ≥ 44', async ({ page }) => {
      await open(page, `/dashboard/approvals?invoice=${fx.inv.A}&d=compact`);
      for (const id of ['decide-approve', 'decide-reject']) {
        expect((await box(page.getByTestId(id))).height).toBeGreaterThanOrEqual(52);
      }
      await page.getByTestId('decide-reject').click();
      const chips = page.locator('[data-reason-chip]');
      expect(await chips.count()).toBeGreaterThan(0);
      for (const chip of await chips.all()) expect((await box(chip)).height).toBeGreaterThanOrEqual(44);
      expect((await box(page.getByTestId('reasons-back'))).height).toBeGreaterThanOrEqual(44);
    });
  });
});

/* ───────────────────────────── 10 · English ───────────────────────────── */

test('10 · English: the head sentence, the names, ltr, an unmirrored glyph, a chip with its code', async ({ page, context }) => {
  await setCookies(context, 'en');
  const calls = recordTrpc(page);
  await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
  expect(plain(await page.getByTestId('approvals-summary-line').innerText())).toBe(
    '2 gaps worth ₪271.50 before VAT, both block payment',
  );
  await expect(page.getByTestId('decide-approve')).toHaveAccessibleName(/^Request .+ credit$/);
  await expect(page.getByTestId('decide-reject')).toHaveAccessibleName('Pay as billed');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await cell(page, fx.gap.A2).click();
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.A2);
  await page.getByTestId('decide-reject').click();
  await sent(page, () => page.getByRole('button', { name: 'It did arrive; the receipt is wrong' }).click());
  expect(decisions(calls)).toEqual([
    {
      path: 'approvals.reject',
      input: { discrepancyId: fx.gap.A2, reason: 'It did arrive; the receipt is wrong', reasonCode: 'received_actual' },
    },
  ]);

  await page.setViewportSize(PHONE);
  const glyph = page.getByTestId('desk-next').locator('svg:visible');
  await expect(glyph).toHaveCount(1);
  expect(await glyph.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
});

/* ───────────────────────────── 11 · accessibility ───────────────────────────── */

test.describe('11 · accessibility', () => {
  for (const [label, viewport] of [
    ['1440', DESKTOP],
    ['390', PHONE],
  ] as const) {
    test(`axe ${label}: the desk, the reasons row, the photo disclosure and the toast`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
      expect(await axeSerious(page), 'the desk').toEqual([]);
      await page.getByTestId('decide-reject').click();
      await expect(page.getByTestId('waive-reasons')).toBeVisible();
      expect(await axeSerious(page), 'the reasons row').toEqual([]);
      await page.getByTestId('reasons-back').click();
      const photo = ev(page).getByTestId('desk-docs-photo');
      await photo.locator('summary').click();
      await expect(photo).toHaveAttribute('open', '');
      expect(await axeSerious(page), 'the photo disclosure').toEqual([]);
      await sent(page, () => page.getByTestId('decide-approve').click());
      await toast(page).hover(); // holds it while axe runs
      await expect(toast(page)).toHaveAttribute('data-undo-state', 'paused');
      expect(await axeSerious(page), 'the toast').toEqual([]);
    });
  }

  test('forced colours: the current row\'s solid outline, the dots keep their colour, the toast has a border', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
    expect(await row(page, fx.gap.A1).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    const adjust = await page.locator('[data-desk] [data-dot]').evaluateAll((els) => els.map((el) => getComputedStyle(el).forcedColorAdjust));
    expect(adjust.length).toBeGreaterThan(0);
    expect(adjust.filter((v) => v !== 'none')).toEqual([]);
    await sent(page, () => page.getByTestId('decide-approve').click());
    await expect(toast(page)).toBeVisible();
    expect(await toast(page).evaluate((el) => getComputedStyle(el).borderTopWidth)).not.toBe('0px');
  });

  test.describe('390', () => {
    test.use({ viewport: PHONE, isMobile: true, hasTouch: true });
    test('the filters fold toggle: Enter and Space flip aria-expanded, focus stays', async ({ page }) => {
      await open(page, `/dashboard/approvals?invoice=${fx.inv.A}`);
      const toggle = page.getByTestId('approvals-filters-toggle');
      await toggle.focus();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toBeFocused();
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toBeFocused();
    });
  });
});

/* ───────────────────────────── 12 · VAT ───────────────────────────── */

test('12 · VAT gaps: the basis first, the larger figure first, never in a batch', async ({ page }) => {
  const calls = recordTrpc(page);
  await open(page, `/dashboard/approvals?invoice=${fx.inv.V}`);
  // The row's sub-line (the summary cell: dot, title + sub, amount) starts with its basis (R7a).
  await expect(cell(page, fx.gap.V1).locator(':scope > span:nth-child(2) > span:nth-child(2)')).toHaveText(/^המע״מ עצמו/);
  await expect(row(page, fx.gap.V1).getByTestId('card-select')).toBeDisabled();
  await expect(row(page, fx.gap.V2).getByTestId('card-select')).toBeEnabled();
  await cell(page, fx.gap.V1).focus();
  await page.keyboard.press('KeyX');
  await expect(page.getByTestId('approvals-announcer')).toHaveText('פער מע״מ לא מאושר בקבוצה');
  await expect(page.locator('[data-batchbar]')).toHaveCount(0);

  await open(page, `/dashboard/approvals?sel=${fx.gap.V2}`);
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.V2);
  await expect(ev(page).getByTestId('group-why')).toHaveText('יש בחשבונית פער מע״מ: החליטו על כל פער לבד');
  await expect(ev(page).getByTestId('group-approve')).toHaveCount(0);

  await open(page, `/dashboard/approvals?sel=${fx.gap.V1}`);
  await expect(ev(page)).toHaveAttribute('data-id', fx.gap.V1);
  const calc = plain(await ev(page).getByTestId('calc-line').innerText());
  expect(calc).toContain('180.00');
  expect(calc.indexOf('180.00'), `the larger figure first: ${calc}`).toBeLessThan(calc.indexOf('178.30'));
  await expect(ev(page).getByTestId('calc-result')).toContainText('1.70');
  await page.getByTestId('decide-reject').click();
  const cost = page.getByTestId('desk-cost-line');
  await expect(cost).toContainText('נמוך מהשיעור');
  await expect(cost).not.toContainText('מעל');
  await page.getByTestId('reasons-back').click();
  await sent(page, () => page.getByTestId('decide-approve').click());
  await expect(toast(page)).toContainText('סכום המע״מ עצמו');
  expect(decisions(calls)).toEqual([approveOf(fx.gap.V1, 170)]);
});
