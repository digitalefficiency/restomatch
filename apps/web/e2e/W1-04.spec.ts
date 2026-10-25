import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { FORBIDDEN_PAIRS } from '../lib/net/__tests__/forbiddenPairs';
import { DEMO_OWNER_EMAIL, DEMO_RESTAURANT_NAME } from './env';
import { e2eSql } from './helpers';

/**
 * W1-04 · Shell resilience (docs/ux/IMPLEMENTATION-PLAN.md §W1-04):
 * forbidden routes render an in-shell 403 (no silent bounce), not-found and
 * errors keep the shell, a branch switch keeps the user's place, the
 * `/dashboard/go` resolver refuses a non-member branch, offline mutations fail
 * at once with a visible chip, an expired session re-authenticates in place,
 * and the QueryClient no longer refetches server-seeded lists on hydration.
 *
 * Signs in with the seeded demo passwords through Auth.js's own endpoints (the
 * magic link is rate-limited per address, and other specs use it).
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const SECOND_BRANCH = `${DEMO_RESTAURANT_NAME} — סניף W1-04`;
const STRANGER_BRANCH = 'מסעדה זרה W1-04';
const ZERO = '00000000-0000-4000-8000-000000000000';
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
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);
}

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

/** Shell chrome is still there (header with the restaurant + the nav). */
async function expectShell(page: Page) {
  await expect(page.locator('header').first()).toBeVisible();
  await expect(page.locator('header').first()).toContainText(DEMO_RESTAURANT_NAME);
}

/* ───────────────────────── fixtures: a second branch, a stranger branch ───────────────────────── */

let mainId = '';
let ownerId = '';
let chefId = '';
let secondId = '';
let strangerId = '';
let billingId = '';

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [main] = await sql<{ id: string; billing: string | null }[]>`
      select id, billing_account_id as billing from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!main) throw new Error('seed has no demo restaurant');
    mainId = main.id;
    const [owner] = await sql<{ id: string }[]>`select id from users where email = ${DEMO_OWNER_EMAIL}`;
    const [chef] = await sql<{ id: string }[]>`select id from users where email = 'chef@kfar-hazeitim.test'`;
    ownerId = owner!.id;
    chefId = chef!.id;
    if (!main.billing) {
      const [acct] = await sql<{ id: string }[]>`
        insert into billing_accounts (name, owner_user_id) values ('e2e W1-04', ${ownerId}) returning id`;
      billingId = acct!.id;
      await sql`update restaurants set billing_account_id = ${billingId} where id = ${mainId}`;
    }
    const [second] = await sql<{ id: string }[]>`
      insert into restaurants (name, billing_account_id) values (${SECOND_BRANCH}, ${billingId || main.billing}) returning id`;
    secondId = second!.id;
    // The owner owns both; the chef is a MANAGER in the second branch (so a
    // screen closed to the chef here opens there: "פתחו ב־<branch>").
    await sql`insert into memberships (user_id, restaurant_id, role) values (${ownerId}, ${secondId}, 'owner'), (${chefId}, ${secondId}, 'manager')`;
    // A restaurant the owner is NOT a member of (the go-resolver attack target).
    const [stranger] = await sql<{ id: string }[]>`insert into restaurants (name) values (${STRANGER_BRANCH}) returning id`;
    strangerId = stranger!.id;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`grant select on purchase_orders to restomatch_app`.catch(() => {});
    if (secondId) await sql`delete from restaurants where id = ${secondId}`;
    if (strangerId) await sql`delete from restaurants where id = ${strangerId}`;
    if (billingId) {
      await sql`update restaurants set billing_account_id = null where billing_account_id = ${billingId}`;
      await sql`delete from billing_accounts where id = ${billingId}`;
    }
  } finally {
    await sql.end();
  }
});

test.use({ viewport: { width: 1440, height: 900 } });

/* ───────────────────────── 1 · forbidden → in-shell 403 ───────────────────────── */

test.describe('forbidden routes render the in-shell 403 page (ia-nav-07)', () => {
  const byRole = new Map<string, string[]>();
  for (const [role, path] of FORBIDDEN_PAIRS) byRole.set(role, [...(byRole.get(role) ?? []), path]);

  for (const [role, paths] of byRole) {
    test(`${role}: ${paths.length} forbidden routes → 403, URL kept, shell kept, no redirect`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(context, page, `${role}@kfar-hazeitim.test`);
      for (const path of paths) {
        const res = await page.goto(path);
        expect(res?.status(), `${role} ${path}`).toBe(403);
        expect(new URL(page.url()).pathname, `${role} ${path}: no silent bounce`).toBe(path);
        await expect(page.getByTestId('forbidden-page')).toBeVisible();
        await expect(page.getByTestId('forbidden-roles')).toContainText(/בעלים/);
        await expectShell(page);
      }
      await context.close();
    });
  }

  test('names the screen and roles, prefills a WhatsApp/e-mail request, and opens it in a branch that allows it', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, 'chef@kfar-hazeitim.test');
    // Make the main branch active (the second one sorts after it, but be explicit).
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard`);
    const res = await page.goto('/dashboard/approvals/pay-run');
    expect(res?.status()).toBe(403);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ריצת תשלומים');
    await expect(page.getByTestId('forbidden-roles')).toHaveText('המסך זמין ל: בעלים, מנהל/ת וחשב/ת.');
    const wa = await page.getByTestId('forbidden-whatsapp').getAttribute('href');
    expect(decodeURIComponent(wa ?? '')).toContain('/dashboard/approvals/pay-run');
    expect(await page.getByTestId('forbidden-email').getAttribute('href')).toMatch(/^mailto:\?subject=/);
    expect(await axe(page), 'axe on the 403 page (he)').toEqual([]);

    await page.getByTestId('forbidden-open-in').click();
    await page.waitForURL((u) => u.pathname === '/dashboard/approvals/pay-run');
    await expect(page.getByTestId('forbidden-page')).toHaveCount(0);
    await expect(page.getByTestId('branch-switcher')).toContainText(SECOND_BRANCH);
    await context.close();
  });

  test('en: the 403 page is in English and axe-clean', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, 'receiver@kfar-hazeitim.test');
    const res = await page.goto('/dashboard/orders?lang=en');
    expect(res?.status()).toBe(403);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("The 'Orders' screen isn't open to your role");
    expect(await axe(page), 'axe on the 403 page (en)').toEqual([]);
    await context.close();
  });
});

/* ───────────────────────── 2 · not-found and errors keep the shell ───────────────────────── */

test.describe('in-shell not-found and error (perf-states-09)', () => {
  test('an unknown entity is a 404 inside the shell, with a way up to its list', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    for (const [path, up] of [
      [`/dashboard/orders/${ZERO}`, '/dashboard/orders'],
      ['/dashboard/orders/not-a-uuid', '/dashboard/orders'],
      [`/dashboard/invoices/${ZERO}`, '/dashboard/approvals'],
      [`/dashboard/products/${ZERO}`, '/dashboard/catalog'],
      [`/dashboard/inventory/${ZERO}`, '/dashboard/inventory'],
      [`/dashboard/recipes/${ZERO}`, '/dashboard/recipes'],
    ] as const) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByTestId('dashboard-not-found')).toBeVisible();
      await expect(page.getByTestId('not-found-up')).toHaveAttribute('href', up);
      await expectShell(page);
    }
    expect(await axe(page), 'axe on the in-shell 404').toEqual([]);
    await context.close();
  });

  test('a failing page shows the in-shell error with a digest-ready retry that recovers', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    const sql = e2eSql();
    try {
      // Only the orders page reads purchase_orders on the server (not the layout).
      await sql`revoke select on purchase_orders from restomatch_app`;
      await page.goto('/dashboard/orders');
      await expect(page.getByTestId('dashboard-error')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('לא הצלחנו לטעון את הדף');
      await expectShell(page);
      expect(await axe(page), 'axe on the in-shell error').toEqual([]);
      await sql`grant select on purchase_orders to restomatch_app`;
      await page.getByTestId('dashboard-error-retry').click();
      await expect(page.getByTestId('dashboard-error')).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe('/dashboard/orders');
    } finally {
      await sql`grant select on purchase_orders to restomatch_app`;
      await sql.end();
      await context.close();
    }
  });
});

/* ───────────────────────── 3 · branch-safe switching + the /go resolver ───────────────────────── */

test.describe('branch switch keeps the place (ia-nav-08, exec-desktop-23)', () => {
  test('approvals?sev=block survives a switch; a detail page falls back to its list with a toast', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard/approvals?sev=block`);
    await expect(page).toHaveURL(/\/dashboard\/approvals\?sev=block$/);

    await page.getByTestId('branch-switcher').click();
    await page.getByTestId('branch-option').filter({ hasText: SECOND_BRANCH }).click();
    await expect(page.getByTestId('branch-switcher')).toContainText(SECOND_BRANCH);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/dashboard/approvals?sev=block');

    // Back to the main branch, from a supplier detail page of the second branch's
    // list → the main branch's supplier LIST (the id belonged to the other branch).
    const sql = e2eSql();
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${mainId} limit 1`;
    await sql.end();
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard/suppliers/${sup!.id}`);
    await page.getByTestId('branch-switcher').click();
    await page.getByTestId('branch-option').filter({ hasText: SECOND_BRANCH }).click();
    await page.waitForURL((u) => u.pathname === '/dashboard/suppliers');
    await expect(page.getByRole('status').filter({ hasText: 'פתחנו את ספקים' })).toBeVisible();
    await context.close();
  });

  test('/dashboard/go switches to a member branch and opens the object (303)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    const res = await page.request.get(`/dashboard/go?r=${secondId}&to=${encodeURIComponent('/dashboard/approvals?sev=block')}`, {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    expect(res.headers()['location']).toMatch(/\/dashboard\/approvals\?sev=block$/);
    await page.goto('/dashboard/approvals');
    await expect(page.getByTestId('branch-switcher')).toContainText(SECOND_BRANCH);
    await context.close();
  });

  test('REGRESSION: /dashboard/go refuses a non-member branch and keeps the session branch', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard`);
    for (const r of [strangerId, ZERO, 'not-a-uuid']) {
      const res = await page.request.get(`/dashboard/go?r=${r}&to=/dashboard/approvals`, { maxRedirects: 0 });
      expect(res.status(), r).toBe(303);
      const loc = new URL(res.headers()['location']!, 'http://x');
      expect(loc.pathname, r).toBe('/dashboard/forbidden');
      expect(loc.searchParams.get('reason')).toBe('notMember');
    }
    await page.goto(`/dashboard/go?r=${strangerId}&to=/dashboard/approvals`);
    await expect(page.getByTestId('forbidden-page')).toContainText('אין לכם גישה לסניף הזה');
    await page.goto('/dashboard');
    await expect(page.getByTestId('branch-switcher')).not.toContainText(STRANGER_BRANCH);
    await expect(page.locator('header').first()).toContainText(DEMO_RESTAURANT_NAME);
    // Open redirect: `to` never leaves the app.
    const evil = await page.request.get(`/dashboard/go?r=${mainId}&to=${encodeURIComponent('//evil.example/x')}`, { maxRedirects: 0 });
    expect(new URL(evil.headers()['location']!, 'http://x').host).toBe(new URL(page.url()).host);
    await context.close();
  });

  test('the chain switch button says "עבדו כסניף הזה"', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard/branches`);
    const buttons = page.getByRole('button', { name: /עבדו כסניף הזה/ });
    await expect(buttons.first()).toBeVisible();
    await context.close();
  });
});

/* ───────────────────────── 4 · offline + expired session ───────────────────────── */

test.describe('connectivity and session layer (perf-states-08, -15)', () => {
  test('offline: the T4 chip appears within 2 s and an approve fails inline at once (never fires later)', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard/approvals`);
    const approve = page.getByRole('button', { name: 'אשר', exact: true }).first();
    await expect(approve).toBeVisible();
    // Requests that reached the server (an offline attempt fails in the browser).
    let approveCalls = 0;
    page.on('requestfinished', (r) => {
      if (r.url().includes('approvals.approve')) approveCalls++;
    });

    await context.setOffline(true);
    await expect(page.getByTestId('offline-chip')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('offline-chip')).toHaveText('אין חיבור · נעדכן כשהרשת תחזור');
    expect(await axe(page).catch(() => []), 'axe with the offline chip').toEqual([]);

    await approve.click();
    await expect(page.getByRole('alert').filter({ hasText: 'הפעולה נכשלה' })).toBeVisible({ timeout: 2_000 });
    await expect(approve).not.toHaveAttribute('aria-busy', 'true');

    await context.setOffline(false);
    await expect(page.getByTestId('offline-chip')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(1_500);
    expect(approveCalls, 'a paused approve must not fire on reconnect').toBe(0);
    await context.close();
  });

  test('expired session: the re-auth sheet opens in place, keeps the typed text, and retries the call', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // The session dies (expiry / sign-out elsewhere): drop the auth cookies only.
    const keep = (await context.cookies()).filter((c) => !/authjs|next-auth/.test(c.name));
    await context.clearCookies();
    await context.addCookies(keep);

    const search = page.locator('header').getByRole('combobox', { name: 'חיפוש כללי' });
    await search.fill('ירקות');
    const sheet = page.getByTestId('reauth-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading')).toHaveText('ההתחברות פגה');
    await expect(sheet.locator('#reauth-email')).toHaveValue(DEMO_OWNER_EMAIL);
    // Shared tablet: another worker has an obvious way to their own sign-in.
    await expect(sheet.getByTestId('reauth-other-user')).toHaveAttribute('href', '/login?callbackUrl=%2Fdashboard');
    expect(await axe(page), 'axe with the re-auth sheet').toEqual([]);

    await sheet.locator('#reauth-password').fill(PASSWORD);
    await sheet.getByRole('button', { name: 'התחברות' }).click();
    await expect(sheet).toBeHidden();
    await expect(search).toHaveValue('ירקות');
    await expect(page.locator('#dashboard-search-header-list')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
    await context.close();
  });
});

/* ───────────────────────── 5 · query defaults + route progress ───────────────────────── */

test.describe('query defaults and route progress (perf-states-04, -01)', () => {
  test('no client refetch of server-seeded lists right after hydration', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    await page.goto(`/dashboard/go?r=${mainId}&to=/dashboard`);
    // [path, procedure, max client fetches]: a server-seeded list (initialData)
    // must not be fetched again; a client-only list exactly once (it was twice).
    for (const [path, procedure, max] of [
      ['/dashboard/orders', 'orders.list', 0],
      ['/dashboard/suppliers', 'suppliers.list', 1],
      ['/dashboard/catalog', 'catalog.items', 1],
    ] as const) {
      const hits: string[] = [];
      const onReq = (r: { url: () => string }) => {
        if (r.url().includes(`/api/trpc/`) && r.url().includes(procedure)) hits.push(r.url());
      };
      page.on('request', onReq);
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1_500);
      page.off('request', onReq);
      expect(hits.length, `${path}: ${procedure} fetched ${hits.length}×`).toBeLessThanOrEqual(max);
    }
    await context.close();
  });

  test('router.push shows the route progress bar', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(context, page, DEMO_OWNER_EMAIL);
    await page.waitForLoadState('networkidle').catch(() => {});
    const phase = await page.evaluate(async () => {
      const w = window as unknown as { next: { router: { push: (h: string) => void } } };
      w.next.router.push('/dashboard/leaks');
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return document.querySelector('[data-route-progress]')?.getAttribute('data-route-progress');
    });
    expect(['start', 'run']).toContain(phase);
    await context.close();
  });
});
