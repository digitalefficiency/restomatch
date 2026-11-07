import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { e2eSql } from './helpers';
import { DEMO_RESTAURANT_NAME } from './env';

/**
 * G-10 (auth-02, P0) · the supplier answer contract on `/s/<token>`: an explicit
 * intent and every line, a contradictory or partial answer refused (422, inline),
 * a replay answered with the RECORDED answer (409). A shortage the supplier
 * reported (10 → 6) is stored and restated — it never turns back into "as ordered".
 */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const PHONE_SMALL = { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const BASE = () => test.info().project.use.baseURL ?? 'http://localhost:3100';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '__screenshots__', 'G-10');

async function setLocale(page: Page, locale: 'he' | 'en') {
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url: BASE() },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE() },
  ]);
}

/** A fresh supplier link for a sent demo order with ≥2 lines and no answer yet (`ttl` < 0 = expired). */
async function freshSupplierLink(ttlHours = 72): Promise<{ token: string; poId: string; lineIds: string[] }> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    await sql`update restaurants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features,supplierConfirm}', 'true'::jsonb, true) where id = ${r!.id}`;
    const [po] = await sql<{ id: string }[]>`
      select po.id from purchase_orders po
      where po.restaurant_id = ${r!.id} and po.status in ('sent','confirmed','partial')
        and (select count(*) from po_lines l where l.po_id = po.id) >= 2
      order by po.created_at desc limit 1`;
    if (!po) throw new Error('no confirmable demo order');
    await sql`delete from supplier_responses where po_id = ${po.id}`;
    const token = randomBytes(32).toString('base64url');
    await sql`
      insert into supplier_confirm_links (restaurant_id, po_id, token_hash, created_at, expires_at)
      values (${r!.id}, ${po.id}, ${createHash('sha256').update(token, 'utf8').digest('hex')},
              now() + make_interval(hours => ${Math.min(0, ttlHours - 72)}), now() + make_interval(hours => ${ttlHours}))`;
    const lines = await sql<{ id: string }[]>`select id from po_lines where po_id = ${po.id} order by id`;
    return { token, poId: po.id, lineIds: lines.map((l) => l.id) };
  } finally {
    await sql.end();
  }
}

async function stored(poId: string) {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ status: string; lines: Array<{ poLineId: string; qtyAvailable: number | null; proposedUnitPrice: number | null }>; note: string | null }[]>`
      select status, lines, note from supplier_responses where po_id = ${poId}`;
    return row ?? null;
  } finally {
    await sql.end();
  }
}

async function qtyOrdered(lineId: string): Promise<number> {
  const sql = e2eSql();
  try {
    const [row] = await sql<{ q: string }[]>`select qty_ordered::text as q from po_lines where id = ${lineId}`;
    return Number(row!.q);
  } finally {
    await sql.end();
  }
}

async function shekelLeftOfDigits(scope: Locator): Promise<string[]> {
  return scope.evaluateAll((els) => {
    const bad: string[] = [];
    for (const el of els) {
      const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes('₪'));
      if (!node || (node.textContent ?? '').search(/\d/) < 0) continue;
      const text = node.textContent ?? '';
      const r = document.createRange();
      r.setStart(node, text.indexOf('₪'));
      r.setEnd(node, text.indexOf('₪') + 1);
      const s = r.getBoundingClientRect();
      const di = text.search(/\d/);
      r.setStart(node, di);
      r.setEnd(node, di + 1);
      const d = r.getBoundingClientRect();
      if (!(s.right <= d.left + 0.5)) bad.push(text);
      if (el.closest('[dir="ltr"]')) bad.push(`dir=ltr around ${text}`);
    }
    return bad;
  });
}

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function seriousAxe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  });
}

/** POST an answer like the portal does (same origin), without a page view — the
 * portal's per-IP view limiter is shared with every other spec on the server. */
async function postAnswer(page: Page, token: string, body: unknown) {
  const res = await page.request.post(`${BASE()}/api/supplier-confirm/${encodeURIComponent(token)}`, {
    data: body,
    headers: { origin: new URL(BASE()).origin },
  });
  return { status: res.status(), json: (await res.json()) as Record<string, unknown> };
}

async function secondBrowserPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await setLocale(page, 'he');
  return page;
}

test.describe('G-10 · supplier answer contract (he 390, touch)', () => {
  test.use(PHONE);

  test('10 → 6 is sent with every line, stored as 6, restated after reload; a second browser gets the recorded notice', async ({ page, browser }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    const ordered0 = await qtyOrdered(lineIds[0]!);
    const short = Math.max(0, Math.floor(ordered0 * 0.6));
    await setLocale(page, 'he');
    await page.goto(`/s/${token}`);
    const primary = page.locator('[data-primary]');
    await expect(primary).toHaveText('אישור ההזמנה כפי שהיא');

    // Capture what the client sends: an explicit intent and EVERY line, never `lines: []`.
    const sent = page.waitForRequest((r) => r.url().includes('/api/supplier-confirm/') && r.method() === 'POST');
    await page.locator(`#qty-${lineIds[0]}`).fill(String(short));
    await expect(primary).toHaveText('שליחת התשובה · שינוי אחד');

    // "as ordered" first → the discard question opens; going back keeps the edit.
    await page.getByRole('button', { name: 'אישור כפי שהוזמן' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'חזרה לשינויים' }).click();
    await expect(page.locator(`#qty-${lineIds[0]}`)).toHaveValue(String(short));

    await primary.click();
    const body = (await sent).postDataJSON() as { intent: string; lines: Array<{ poLineId: string; qtyAvailable: number | null }> };
    expect(body.intent).toBe('with_changes');
    expect(body.lines.map((l) => l.poLineId).sort()).toEqual([...lineIds].sort());
    expect(body.lines.every((l) => l.qtyAvailable !== null)).toBe(true);

    await expect(page.getByTestId('portal-done')).toContainText('חוסר');
    const row = await stored(poId);
    expect(row?.status).toBe('changes');
    expect(row?.lines).toEqual([{ poLineId: lineIds[0], qtyAvailable: short, proposedUnitPrice: null }]);

    await page.reload();
    await expect(page.getByTestId('portal-answered')).toContainText('התשובה שנרשמה');
    await expect(page.getByTestId('portal-answered')).toContainText('חוסר');

    // A second browser (another person at the supplier) posts: 409 with the recorded answer, then the notice with its date.
    const other = await secondBrowserPage(browser);
    await other.goto(`/s/${token}`);
    const replay = await postAnswer(other, token, { intent: 'as_ordered', lines: lineIds.map((id) => ({ poLineId: id, qtyAvailable: null })), note: 'ניסיון שני' });
    expect(replay.status).toBe(409);
    expect(replay.json).toMatchObject({ ok: false, error: 'already_answered', recorded: { status: 'changes', lines: row?.lines } });
    expect(JSON.stringify(replay.json)).not.toContain('ניסיון שני');
    await expect(other.getByTestId('portal-answered')).toContainText('כבר התקבלה תשובה להזמנה זו');
    await expect(other.getByTestId('portal-answered')).toContainText(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/);
    await other.context().close();
    expect((await stored(poId))?.note).toBeNull();
  });

  test('a contradictory answer (as_ordered with a shortage) → 422 intent_mismatch; nothing stored', async ({ page }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    const lines = lineIds.map((id, i) => ({ poLineId: id, qtyAvailable: i === 0 ? 0 : null }));
    const mismatch = await postAnswer(page, token, { intent: 'as_ordered', lines });
    expect(mismatch).toEqual({ status: 422, json: { ok: false, error: 'intent_mismatch' } });
    const partial = await postAnswer(page, token, { intent: 'as_ordered', lines: [] });
    expect(partial).toEqual({ status: 422, json: { ok: false, error: 'incomplete_answer' } });
    expect(await stored(poId)).toBeNull();
  });

  test('a 422 from the server is an inline error on the form, never the done card', async ({ page }) => {
    const { token, poId, lineIds } = await freshSupplierLink();
    await setLocale(page, 'he');
    await page.route('**/api/supplier-confirm/**', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'incomplete_answer' }) }),
    );
    await page.goto(`/s/${token}`);
    await page.locator(`#qty-${lineIds[0]}`).fill('0');
    await page.locator('[data-primary]').click();
    await expect(page.getByTestId('portal-actions').getByRole('alert')).toHaveText('חסרה כמות באחת השורות. מלאו כמות לכל שורה (0 = אזל).');
    await expect(page.getByTestId('portal-done')).toHaveCount(0);
    await expect(page.locator(`#qty-${lineIds[0]}`)).toHaveValue('0');
    expect(await stored(poId)).toBeNull();
  });
});

/* ── DoD-1/2/4: every /s state, he 390 + 375 (touch), he/en 1440 — axe, overflow, ₪ side, screenshots ── */
mkdirSync(SHOTS, { recursive: true });
const VIEWS = [
  ['he', '390', PHONE],
  ['he', '375', PHONE_SMALL],
  ['he', '1440', DESKTOP],
  ['en', '1440', DESKTOP],
] as const;

for (const [locale, vp, use] of VIEWS) {
  test.describe(`G-10 screens ${locale} · ${vp}`, () => {
    test.use(use);
    for (const state of ['open', 'answered', 'expired', 'unknown'] as const) {
      test(`/s ${state}: axe clean, no overflow, ₪ left of digits, legal footer`, async ({ page }) => {
        let path = `/s/${'z'.repeat(43)}`;
        if (state !== 'unknown') {
          const { token, poId, lineIds } = await freshSupplierLink(state === 'expired' ? -1 : 72);
          path = `/s/${token}`;
          if (state === 'answered') {
            const r = await postAnswer(page, token, {
              intent: 'with_changes',
              lines: lineIds.map((id, i) => ({ poLineId: id, qtyAvailable: i === 0 ? 0 : null })),
              note: 'יגיע מחר',
            });
            // with_changes needs every quantity → 422; answer it completely instead.
            expect(r.status).toBe(422);
            const full = await Promise.all(lineIds.map(async (id, i) => ({ poLineId: id, qtyAvailable: i === 0 ? 0 : await qtyOrdered(id) })));
            expect((await postAnswer(page, token, { intent: 'with_changes', lines: full, note: 'יגיע מחר' })).status).toBe(200);
            expect((await stored(poId))?.lines).toHaveLength(1);
          }
        }
        await setLocale(page, locale);
        await page.goto(path);
        await page.waitForLoadState('networkidle').catch(() => {});
        if (state === 'open') await expect(page.locator('[data-primary]')).toBeVisible();
        if (state === 'answered') await expect(page.getByTestId('portal-answered')).toBeVisible();
        expect(await seriousAxe(page), `${state} axe`).toEqual([]);
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('footer a[href="/accessibility"]')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        if (locale === 'he') expect(await shekelLeftOfDigits(page.locator('main bdi'))).toEqual([]);
        // DoD screens are product-only: hide the `next dev` indicator.
        await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
        await page.screenshot({ path: join(SHOTS, `${state}-${locale}-${vp}.png`), fullPage: true });
      });
    }
  });
}
