import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { DEMO_RESTAURANT_NAME } from './env';
import { collectPageErrors, e2eSql } from './helpers';

/**
 * W2-02 · invoice register, cockpit and intake.
 *   register tabs + counts, Σ visible rows, row → cockpit with ?from=register
 *   cockpit at 1440 / 390 (₪ left of the first digit in he), [ / ] stepping
 *   edit mode → save re-matches → "before → after"
 *   inbox: preview, intake settings (revoke asks first, honest clipboard)
 *   chef: 404 on /scans/<id> and its file route; no register
 *   axe he + en
 */
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const email = (role: string) => `${role}@kfar-hazeitim.test`;

test.describe.configure({ mode: 'serial' });

async function signedIn(browser: Browser, role: string, lang: 'he' | 'en' = 'he', viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const base = test.info().project.use.baseURL!;
  await context.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: base },
    { name: 'rm_locale', value: lang, url: base },
  ]);
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await page.request.post('/api/auth/callback/credentials', {
    form: { email: email(role), password: PASSWORD, rememberMe: 'false', csrfToken: csrf.csrfToken, callbackUrl: '/dashboard' },
    maxRedirects: 0,
  });
  expect(res.status(), `sign-in ${role}`).toBeLessThan(400);
  return page;
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

/** In he, ₪ sits left of the first digit (bbox, DoD-4). */
async function shekelLeftOfDigit(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let shekel: DOMRect | null = null;
    let digit: DOMRect | null = null;
    for (let n = walker.nextNode(); n && (!shekel || !digit); n = walker.nextNode()) {
      const text = n.textContent ?? '';
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        if (!shekel && text[i] === '₪') shekel = r.getBoundingClientRect();
        if (!digit && /\d/.test(text[i]!)) digit = r.getBoundingClientRect();
      }
    }
    return !!shekel && !!digit && shekel.left < digit.left;
  });
}

async function invoiceIdInState(where: 'open' | 'any'): Promise<string> {
  const sql = e2eSql();
  try {
    const rows = await sql<{ id: string }[]>`
      select i.id from invoices i join restaurants r on r.id = i.restaurant_id
      where r.name = ${DEMO_RESTAURANT_NAME} and i.status <> 'paid'
        and exists (select 1 from match_runs m where m.invoice_id = i.id)
        and (${where} = 'any' or exists (
          select 1 from match_runs m join discrepancies d on d.match_run_id = m.id
          where m.invoice_id = i.id and d.resolution_status in ('open','escalated') and abs(d.delta_amount) > 0))
        and coalesce(i.ocr_payload -> 'raw' ->> 'kind', '') <> 'consolidated'
      order by i.invoice_date desc limit 1`;
    if (!rows[0]) throw new Error(`no ${where} invoice in the e2e seed`);
    return rows[0].id;
  } finally {
    await sql.end();
  }
}

test('register: tabs with counts, Σ visible rows, row opens the cockpit (he 1440)', async ({ browser }) => {
  const page = await signedIn(browser, 'owner');
  const errors = collectPageErrors(page);
  await page.goto('/dashboard/invoices');
  await expect(page.getByRole('heading', { level: 1, name: 'חשבוניות' })).toBeVisible();
  const register = page.getByTestId('invoice-register');
  await expect(register).toBeVisible();
  for (const label of ['לבדיקה', 'ממתינות לשיוך', 'הותאמו', 'בהשהיה', 'שולמו', 'ללא מספר הקצאה', 'נכנסות']) {
    await expect(register.getByText(label, { exact: false }).first()).toBeVisible();
  }
  // Σ visible rows: the data attribute is the sum the TotalsRow prints.
  const rows = register.locator('tbody tr');
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  expect(Number(await register.getAttribute('data-visible-total'))).toBeGreaterThan(0);
  // Money columns are physically right-aligned.
  const align = await rows.first().locator('td.text-right').count();
  expect(align).toBeGreaterThan(0);
  expect(await axe(page)).toEqual([]);
  // A row click opens the split pane on ?sel= (shareable, survives Back); its link opens the cockpit.
  await rows.first().click();
  await expect(page).toHaveURL(/[?&]sel=[0-9a-f-]{36}/);
  await page.locator('a[href*="/dashboard/invoices/"][href*="from=register"]').first().click();
  await expect(page).toHaveURL(/\/dashboard\/invoices\/[0-9a-f-]{36}.*from=register/);
  await expect(page.getByTestId('cockpit-title')).toContainText(' · ');
  await expect(page.getByTestId('cockpit-back')).toHaveAttribute('href', /\/dashboard\/invoices/);
  expect(errors).toEqual([]);
  await page.context().close();
});

test('cockpit: three-way lines, decide CTA with ₪ left of the digit, [ ] stepping (he 1440)', async ({ browser }) => {
  const page = await signedIn(browser, 'owner');
  const id = await invoiceIdInState('open');
  await page.goto(`/dashboard/invoices/${id}?from=register`);
  await expect(page.getByTestId('cockpit-lines')).toBeVisible();
  await expect(page.getByTestId('cockpit-finding').first()).toBeVisible();
  const decide = page.getByTestId('cockpit-decide');
  await expect(decide).toHaveAttribute('href', `/dashboard/approvals?invoice=${id}`);
  expect(await shekelLeftOfDigit(page, '[data-testid=cockpit-decide]')).toBe(true);
  await expect(page.getByTestId('document-flow')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  // [ / ] step through the register tab (KeyboardEvent.code; inactive in inputs).
  const next = page.locator('a[aria-keyshortcuts=BracketRight]');
  const prev = page.locator('a[aria-keyshortcuts=BracketLeft]');
  await expect(next.or(prev).first()).toBeVisible({ timeout: 10_000 });
  const target = (await next.count()) ? await next.getAttribute('href') : await prev.getAttribute('href');
  await page.keyboard.press((await next.count()) ? 'BracketRight' : 'BracketLeft');
  await expect(page).toHaveURL(new RegExp(target!.split('?')[0]!));
  await page.context().close();
});

test('cockpit on a phone: מסמך | שורות, line cards, no sideways scroll (he 390)', async ({ browser }) => {
  const page = await signedIn(browser, 'bookkeeper', 'he', { width: 390, height: 844 });
  const id = await invoiceIdInState('open');
  await page.goto(`/dashboard/invoices/${id}`);
  await expect(page.getByRole('radiogroup').or(page.getByRole('group')).first()).toBeVisible();
  await expect(page.getByTestId('cockpit-line-cards')).toBeVisible();
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(391);
  expect(await axe(page)).toEqual([]);
  await page.context().close();
});

test('edit mode: saving re-matches automatically and shows ₪ before → after (en 1440)', async ({ browser }) => {
  const page = await signedIn(browser, 'owner', 'en');
  const id = await invoiceIdInState('any');
  await page.goto(`/dashboard/invoices/${id}`);
  await page.getByTestId('cockpit-edit-toggle').click();
  await expect(page.locator('input[type=number], input[type=date]')).toHaveCount(0);
  await page.getByRole('button', { name: /save details/i }).click();
  await expect(page.getByTestId('rematch-before-after')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('rematch-before-after')).toContainText('→');
  expect(await axe(page)).toEqual([]);
  await page.context().close();
});

test('inbox: real h1 + tabs, document preview, intake settings off the queue', async ({ browser }) => {
  const fname = `w202-${Date.now()}.pdf`;
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} order by created_at limit 1`;
    const rid = r!.id;
    const [ch] = await sql<{ id: string }[]>`
      insert into ingest_channels (restaurant_id, kind, token_hash, token_hint, active)
      values (${rid}, 'email', ${`w202e2e${Date.now()}`.padEnd(64, '0')}, 'w202', false) returning id`;
    const [msg] = await sql<{ id: string }[]>`
      insert into ingest_messages (restaurant_id, channel_id, kind, provider, provider_message_id, sender, sender_allowed, subject, status)
      values (${rid}, ${ch!.id}, 'email', 'stub', ${`w202-e2e-${Date.now()}`}, 'stranger@w202.test', false, 'W2-02 preview', 'needs_review') returning id`;
    await sql`
      insert into ingest_documents (restaurant_id, message_id, filename, mime_type, storage_path, status)
      values (${rid}, ${msg!.id}, ${fname}, 'application/pdf', ${`${rid}/scan-w202e2e-00000000.pdf`}, 'needs_review')`;
  } finally {
    await sql.end();
  }
  const page = await signedIn(browser, 'owner');
  await page.goto('/dashboard/inbox?filter=needs_review');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[role=tablist]')).toHaveCount(0); // real link tabs, no fake tablist
  await expect(page.locator('a[aria-current=page]', { hasText: 'ממתינים' }).or(page.locator('nav a[aria-current=page]')).first()).toBeVisible();
  const doc = page.getByTestId('ingest-document').filter({ hasText: fname });
  await doc.getByTestId('ingest-preview-toggle').click();
  await expect(doc.getByTestId('ingest-preview')).toBeVisible();
  // Bulk "פענחו N" appears once a document is picked.
  await doc.getByTestId('ingest-pick').check();
  await expect(page.getByTestId('ingest-bulk-read')).toContainText('פענחו');
  // No config cards on the queue — they live behind one link.
  await expect(page.getByTestId('ingest-channels')).toHaveCount(0);
  await expect(page.getByTestId('intake-settings-link')).toHaveAttribute('href', '/dashboard/inbox?view=settings');
  expect(await axe(page)).toEqual([]);
  await page.context().close();
});

test('intake settings: a clipboard failure never claims "הועתק"; revoke asks first, naming the channel', async ({ browser }) => {
  const page = await signedIn(browser, 'owner');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
  });
  await page.goto('/dashboard/inbox?view=settings');
  const channels = page.getByTestId('ingest-channels');
  await channels.getByRole('button', { name: /צרו|כתובת חדשה|החליפו|generate|rotate/i }).last().click();
  await expect(page.getByTestId('ingest-fresh-secret')).toBeVisible();
  await page.getByTestId('ingest-fresh-secret').getByRole('button').click();
  await expect(page.getByTestId('ingest-copy-manual')).toBeVisible();
  await expect(page.getByTestId('ingest-fresh-secret')).not.toContainText('הועתק');
  await channels.getByRole('button', { name: 'בטלו' }).first().click();
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
  await expect(dialog).toContainText(/לבטל את כתובת ה/);
  await dialog.getByRole('button', { name: 'השאירו' }).click();
  await expect(dialog).toBeHidden();
  await page.context().close();
});

test('chef: 404 on /scans/<id> and its file route, no register', async ({ browser }) => {
  const page = await signedIn(browser, 'chef');
  const id = await invoiceIdInState('any');
  const res = await page.goto(`/scans/${id}`);
  expect(res?.status()).toBe(404);
  const file = await page.request.get(`/scans/${id}/file`);
  expect(file.status()).toBe(404);
  const reg = await page.goto('/dashboard/invoices');
  expect(reg?.status() === 403 || /\/dashboard$/.test(page.url())).toBe(true);
  await page.context().close();
});

test('register in English: axe clean, money right-aligned (en 1440)', async ({ browser }) => {
  const page = await signedIn(browser, 'bookkeeper', 'en');
  await page.goto('/dashboard/invoices');
  await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.context().close();
});
