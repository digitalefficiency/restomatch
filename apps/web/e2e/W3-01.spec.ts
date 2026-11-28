import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DEMO_OWNER_EMAIL, DEMO_RESTAURANT_NAME } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W3-01 · "כל הסניפים" (docs/ux/wave3/W3-01.md §5):
 *  - the matrix lists every owned branch, with a pinned total row;
 *  - a branch with no invoices reads "אין נתונים" (T4), never ₪0 as a leak;
 *  - the scope chips narrow the matrix by URL (soft navigation, no reload);
 *  - worst branch → its biggest item in ≤2 clicks and 0 reloads
 *    (leak cell → 520 px peek → "פתיחת החשבונית");
 *  - the "לפי סניף" strip on approvals and the pay run is axe-clean (he + en).
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const SECOND_BRANCH = `${DEMO_RESTAURANT_NAME} — סניף W3-01`;

let mainId = '';
let secondId = '';
let billingId = '';
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function signIn(context: BrowserContext, page: Page, email: string): Promise<void> {
  const base = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: base },
    { name: 'rm_locale', value: 'he', url: base },
  ]);
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email, password: PASSWORD, rememberMe: 'false', csrfToken: csrf.csrfToken, callbackUrl: '/dashboard' },
    maxRedirects: 0,
  });
  expect(res.status(), `password sign-in for ${email}`).toBeLessThan(400);
}

/** Serious/critical WCAG 2.x A/AA violations (the W1-04 helper: same tags, same exclusions). */
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

/** Marks the document; a full reload drops the mark. */
async function markDocument(page: Page) {
  await page.evaluate(() => ((window as unknown as { __w301: number }).__w301 = 1));
}
async function expectSameDocument(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __w301?: number }).__w301), 'no full reload').toBe(1);
}

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [main] = await sql<{ id: string; billing: string | null }[]>`
      select id, billing_account_id as billing from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!main) throw new Error('seed has no demo restaurant');
    mainId = main.id;
    const [owner] = await sql<{ id: string }[]>`select id from users where email = ${DEMO_OWNER_EMAIL}`;
    if (!main.billing) {
      const [acct] = await sql<{ id: string }[]>`
        insert into billing_accounts (name, owner_user_id) values ('e2e W3-01', ${owner!.id}) returning id`;
      billingId = acct!.id;
      await sql`update restaurants set billing_account_id = ${billingId} where id = ${mainId}`;
    }
    const [second] = await sql<{ id: string }[]>`
      insert into restaurants (name, billing_account_id) values (${SECOND_BRANCH}, ${billingId || main.billing}) returning id`;
    secondId = second!.id;
    await sql`insert into memberships (user_id, restaurant_id, role) values (${owner!.id}, ${secondId}, 'owner')`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    if (secondId) await sql`delete from restaurants where id = ${secondId}`;
    if (billingId) {
      await sql`update restaurants set billing_account_id = null where billing_account_id = ${billingId}`;
      await sql`delete from billing_accounts where id = ${billingId}`;
    }
  } finally {
    await sql.end();
  }
});

test('W3-01 · the chain matrix: total row, T4 empty branch, scope chips, ≤2-click drill with 0 reloads', async ({ page, context }) => {
  // next dev compiles the invoice route on first open: the drill step needs more than the default budget.
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await signIn(context, page, DEMO_OWNER_EMAIL);

  await test.step('reached in one click from the chain page', async () => {
    await page.goto('/dashboard/chain');
    await page.getByTestId('chain-open-matrix').click();
    await expect(page).toHaveURL(/\/dashboard\/chain\/matrix/);
  });

  const table = page.getByTestId('matrix-table');
  await expect(table).toBeVisible();
  const rows = page.getByTestId('matrix-row');

  await test.step('both branches + the pinned total row; the empty branch is T4, not a ₪0 leak', async () => {
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('matrix-total')).toBeVisible();
    await expect(page.getByTestId('matrix-total-leak')).toContainText('₪');
    const empty = rows.filter({ hasText: SECOND_BRANCH });
    await expect(empty).toContainText('אין נתונים');
    await expect(page.getByTestId('matrix-row-error')).toHaveCount(0);
    await expect(page.getByTestId('matrix-partial')).toHaveCount(0);
  });

  await test.step('every [data-drill] door carries its total (G-16), and the leak doors sum to the total row', async () => {
    const totals = await page.locator('[data-drill]').evaluateAll((els) => els.map((e) => e.getAttribute('data-drill-total')));
    expect(totals.length).toBeGreaterThan(0);
    for (const v of totals) expect(v, 'data-drill-total').toMatch(/^-?\d+$/);
    const leakDoors = await page
      .locator('a[data-drill]:has([data-testid="matrix-leak"])')
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-drill-total'))));
    const totalText = (await page.getByTestId('matrix-total-leak').innerText()).replace(/[^\d]/g, '');
    expect(leakDoors.reduce((a, b) => a + b, 0)).toBe(Number(totalText) * 100);
  });

  await markDocument(page);

  await test.step('scope chip narrows to one branch and back (URL, soft navigation)', async () => {
    const chips = page.getByTestId('matrix-scope');
    await chips.getByRole('link', { name: SECOND_BRANCH }).click();
    await expect(page).toHaveURL(new RegExp(`b=${secondId}`));
    await expect(rows).toHaveCount(1);
    await chips.getByRole('link', { name: 'כל הסניפים' }).click();
    await expect(rows).toHaveCount(2);
    await expectSameDocument(page);
  });

  await test.step('worst branch → its biggest item: 2 clicks, 0 reloads', async () => {
    const worst = rows.filter({ hasText: DEMO_RESTAURANT_NAME }).filter({ hasNotText: SECOND_BRANCH });
    await worst.getByTestId('matrix-leak').click(); // click 1: opens the peek
    const peek = page.getByTestId('matrix-peek');
    await expect(peek).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`peek=${mainId}`));
    const box = await peek.boundingBox();
    if (box && (page.viewportSize()?.width ?? 0) >= 1024) expect(Math.round(box.width)).toBe(520);
    await expect(page.getByTestId('matrix-peek-invoices')).toBeVisible();
    await page.getByTestId('matrix-peek-open').first().click(); // click 2: the invoice
    await expect(page).toHaveURL(/\/dashboard\/invoices\/[0-9a-f-]{36}/, { timeout: 120_000 });
    await expectSameDocument(page);
  });

  await test.step('the "לפי סניף" strip on approvals and the pay run: one row per branch, switch only on the others', async () => {
    for (const [path, kind] of [
      ['/dashboard/approvals', 'approvals'],
      ['/dashboard/approvals/pay-run', 'payRun'],
    ] as const) {
      await page.goto(path);
      const strip = page.getByTestId(`branch-strip-${kind}`);
      await expect(strip).toBeVisible({ timeout: 120_000 });
      const stripRows = strip.getByTestId('branch-strip-row');
      await expect(stripRows).toHaveCount(2);
      await expect(stripRows.filter({ hasText: SECOND_BRANCH }).getByRole('button')).toHaveCount(1);
      await expect(page.locator(`[data-testid="branch-strip-row"][data-branch="${mainId}"]`).getByRole('button')).toHaveCount(0);
    }
  });

  expect(errors, 'no page errors').toEqual([]);
});

test('W3-01 · the "לפי סניף" strip is axe-clean on approvals and the pay run (he + en, 2 branches)', async ({ page, context }) => {
  // The active row's "הסניף הפעיל" badge once sat on a doubled info tint (4.41:1, W1-04:325).
  test.setTimeout(180_000);
  await signIn(context, page, DEMO_OWNER_EMAIL);
  await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard`);
  const base = test.info().project.use.baseURL!;
  for (const locale of ['he', 'en'] as const) {
    await context.addCookies([{ name: 'rm_locale', value: locale, url: base }]);
    for (const [path, kind] of [
      ['/dashboard/approvals', 'approvals'],
      ['/dashboard/approvals/pay-run', 'payRun'],
    ] as const) {
      await test.step(`${locale} · ${path}`, async () => {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const strip = page.getByTestId(`branch-strip-${kind}`);
        await expect(strip).toBeVisible({ timeout: 120_000 });
        await expect(strip.getByTestId('branch-strip-row')).toHaveCount(2);
        // The active row (no switch button) is the node the contrast rule reads.
        await expect(page.locator(`[data-testid="branch-strip-row"][data-branch="${mainId}"]`).getByRole('button')).toHaveCount(0);
        await page.waitForLoadState('networkidle').catch(() => {});
        expect(await axe(page), `axe on ${path} (${locale}) with the branch strip`).toEqual([]);
      });
    }
  }
});
