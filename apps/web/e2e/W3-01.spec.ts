import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { DEMO_OWNER_EMAIL, DEMO_RESTAURANT_NAME } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W3-01 · "כל הסניפים" (docs/ux/wave3/W3-01.md §5):
 *  - the matrix lists every owned branch, with a pinned total row;
 *  - a branch with no invoices reads "אין נתונים" (T4), never ₪0 as a leak;
 *  - the scope chips narrow the matrix by URL (soft navigation, no reload);
 *  - worst branch → its biggest item in ≤2 clicks and 0 reloads
 *    (leak cell → 520 px peek → "פתיחת החשבונית").
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const SECOND_BRANCH = `${DEMO_RESTAURANT_NAME} — סניף W3-01`;

let mainId = '';
let secondId = '';
let billingId = '';

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
    await expect(page).toHaveURL(/\/dashboard\/invoices\/[0-9a-f-]{36}/);
    await expectSameDocument(page);
  });

  expect(errors, 'no page errors').toEqual([]);
});
