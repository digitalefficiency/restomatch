/**
 * The receiving photo beat with NO worker process — the proof that production
 * runs on the web app alone (after() kick + /api/cron/jobs; no Mac, no Redis).
 *
 * Against a running web server (`next start`, NODE_ENV=development at runtime so
 * the dev OCR stub + local scan storage apply — both refuse production by design;
 * no NEXT_PUBLIC_SUPABASE_URL at runtime, like e2e/run-demo-path.sh's stub server)
 * on a local demo database (reseed:demo --today 2026-10-25), with NO worker:
 *
 *   1. the receiver opens today's HaSharon Produce order, photographs the invoice,
 *      waits for "Check result", sets both differences "= order", closes;
 *   2. the dock slip shows the engine ₪ — the re-match ran;
 *   3. every job of that invoice was claimed by a `serverless:` runner (the web
 *      process), none by a worker;
 *   4. the leak hero moved by exactly one PRICE_HIGHER (the stub bills one line
 *      +8%; the one-unit quantity difference is within tolerance);
 *   5. /api/cron/jobs: called once BEFORE the beat (one Vercel Cron minute: the
 *      heartbeat), never during it; after it: 401 without / with a wrong bearer,
 *      200 with it, and the 'vercel-cron' heartbeat is fresh.
 *
 *   cd apps/web && QA_BASE_URL=http://localhost:3503 DATABASE_URL=… CRON_SECRET=… \
 *     PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec tsx scripts/qa-no-worker.ts
 *
 * Local databases only. Prints a JSON report; exit 1 on any failed check.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import postgres from 'postgres';
import { computeLeakHero, isLeakType } from '@restomatch/charts';
import { createDb } from '@restomatch/db';
import { en as marketingEn } from '../lib/i18n/messages/marketing/en';
import { en as receivingEn } from '../lib/i18n/messages/receiving/en';

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:3503';
const DB_URL = process.env.DATABASE_URL ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';
const DEMO_TODAY = process.env.DEMO_TODAY ?? '2026-10-25';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const RECEIVER = 'receiver@kfar-hazeitim.test';
const SHOTS = process.env.QA_SHOTS ?? join(process.cwd(), 'test-results', 'qa-no-worker');
const r = receivingEn.steps;

const host = (() => {
  try {
    return new URL(DB_URL).hostname;
  } catch {
    return '';
  }
})();
if (!['localhost', '127.0.0.1'].includes(host)) {
  console.error(`qa-no-worker: refusing DATABASE_URL host "${host}" (local databases only)`);
  process.exit(2);
}

const sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
const db = createDb(DB_URL);
const checks: Array<{ check: string; ok: boolean; detail?: unknown }> = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  checks.push({ check: name, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
};
const agorot = (n: number) => Math.round(n * 100);

async function dismissCookieBanner(page: Page) {
  const bar = page.getByRole('dialog', { name: marketingEn.cookie.label });
  if (await bar.isVisible().catch(() => false)) await bar.getByRole('button', { name: marketingEn.cookie.necessary }).click();
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }).catch(() => {});
}

async function main() {
  // ── setup: the demo tenant, today's HaSharon order, the hero before ─────────
  const [rest] = await sql<Array<{ id: string }>>`SELECT id FROM restaurants WHERE name = 'כפר הזיתים' LIMIT 1`;
  if (!rest) throw new Error('no demo restaurant — reseed:demo first');
  const [po] = await sql<Array<{ id: string; supplier_id: string }>>`
    SELECT po.id, po.supplier_id FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.restaurant_id = ${rest.id} AND s.name_en = 'HaSharon Produce'
       AND (po.expected_delivery_at AT TIME ZONE 'Asia/Jerusalem')::date = ${DEMO_TODAY}::date
       AND NOT EXISTS (SELECT 1 FROM goods_receipts g WHERE g.po_id = po.id)
     LIMIT 1`;
  if (!po) throw new Error(`no open HaSharon Produce order due ${DEMO_TODAY}`);
  const workers = await sql<Array<{ worker_id: string; host: string; beat_at: Date }>>`
    SELECT worker_id, host, beat_at FROM worker_heartbeats ORDER BY beat_at DESC`;
  check('no worker heartbeat on this database (no worker process)', workers.every((w) => w.worker_id === 'vercel-cron'), workers);
  // One cron minute, as Vercel Cron would (beats 'vercel-cron', so the dashboard's
  // "engine unavailable" banner is off). It is NOT called again during the beat:
  // the photo's OCR and the post-count match must come from the after() kick.
  const first = await fetch(`${BASE}/api/cron/jobs`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  check('a cron minute before the beat → 200', first.status === 200, await first.json());
  const t0 = new Date();
  const heroBefore = await computeLeakHero(db, rest.id, { now: new Date() });

  // ── the receiver: photo → OCR → review → "= order" → close ──────────────────
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  try {
    await page.goto(`${BASE}/login?lang=en`);
    await dismissCookieBanner(page);
    const form = page.locator('form', { has: page.locator('input[name="password"]') });
    await form.locator('input[name="email"]').fill(RECEIVER);
    await form.locator('input[name="password"]').fill(PASSWORD);
    await form.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    await page.goto(`${BASE}/dashboard/receiving/${po.id}`, { waitUntil: 'load' });
    await dismissCookieBanner(page);
    await page.getByRole('heading', { name: r.scan.title }).waitFor({ timeout: 30_000 });
    await shot(page, '1-scan');

    // A photographed paper invoice (rendered once, uploaded as a JPEG).
    const paper = await browser.newPage({ viewport: { width: 800, height: 1100 } });
    await paper.setContent(
      `<div dir="rtl" style="font:22px sans-serif;padding:40px;background:#fff;color:#111">
         <h2>ירקות השרון בע״מ — חשבונית מס</h2><p>עגבניות שרי 15 ק״ג × 12.96</p><p>סה״כ לתשלום</p></div>`,
    );
    const photo = await paper.screenshot({ type: 'jpeg', quality: 80 });
    await paper.close();
    const processBtn = page.getByRole('button', { name: r.scan.process });
    for (let i = 0; i < 2 && !(await processBtn.isVisible().catch(() => false)); i += 1) {
      await page.locator('input[type="file"]').setInputFiles({ name: 'invoice.jpg', mimeType: 'image/jpeg', buffer: photo });
      await processBtn.waitFor({ timeout: 5_000 }).catch(() => {});
    }
    const tUpload = Date.now();
    await processBtn.click();
    await page.getByRole('heading', { name: r.recon.title }).waitFor({ timeout: 90_000 });
    const ocrSeconds = (Date.now() - tUpload) / 1000;
    const fellBack = await page.locator('[data-testid^="ocr-notice"]').count();
    check('"Check result" after the photo — OCR ran with no worker (after() kick)', fellBack === 0, { seconds: ocrSeconds });
    await shot(page, '2-check-result');

    await page.getByTestId('continue-adjust').click();
    await page.getByRole('heading', { name: r.adjust.title }).waitFor({ timeout: 30_000 });
    const prefix = r.adjust.asOrdered.split('{qty}')[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asOrdered = page.getByRole('button', { name: new RegExp(`^${prefix}`) });
    const differences = await asOrdered.count();
    // "= order" on every difference card (the demo pack's count), one card at a time.
    for (let i = 0; i < differences; i += 1) await asOrdered.nth(i).click();
    check('two difference cards, both set "= order"', differences === 2, { differences });
    await shot(page, '3-adjust');
    await page.getByTestId('close-receipt').click();
    await page.getByTestId('receipt-confirmed').waitFor({ timeout: 30_000 });
    const tClose = Date.now();
    await page.getByTestId('dock-slip-total').waitFor({ timeout: 90_000 });
    check('dock slip shows the engine ₪ — the re-match ran with no worker', true, { seconds: (Date.now() - tClose) / 1000 });
    await shot(page, '4-confirmed-dock-slip');
  } finally {
    await browser.close();
  }

  // ── what ran it, and what it found ──────────────────────────────────────────
  const [inv] = await sql<Array<{ id: string; status: string }>>`
    SELECT id, status FROM invoices WHERE restaurant_id = ${rest.id} AND created_at >= ${t0} ORDER BY created_at DESC LIMIT 1`;
  const jobs = await sql<Array<{ queue: string; status: string; locked_by: string | null; attempts: number; finished_at: Date | null }>>`
    SELECT queue, status, locked_by, attempts, finished_at FROM job_queue
     WHERE payload->>'invoiceId' = ${inv!.id} ORDER BY id`;
  check(
    'every job of the invoice ran in the web process (locked_by serverless:…), done',
    jobs.length >= 2 && jobs.every((j) => j.status === 'done' && (j.locked_by ?? '').startsWith('serverless:')),
    jobs.map((j) => ({ queue: j.queue, status: j.status, by: j.locked_by, attempts: j.attempts })),
  );
  check('ocr-invoice then match-invoice', jobs[0]?.queue === 'ocr-invoice' && jobs.some((j) => j.queue === 'match-invoice'));
  const found = await sql<Array<{ type: string; severity: string; delta: string }>>`
    SELECT d.type, d.severity, d.delta_amount AS delta FROM discrepancies d JOIN match_runs mr ON mr.id = d.match_run_id
     WHERE mr.invoice_id = ${inv!.id} ORDER BY d.type`;
  const leakFindings = found.filter((d) => ['warn', 'block'].includes(d.severity) && isLeakType(d.type));
  check('exactly one leak finding, PRICE_HIGHER', leakFindings.length === 1 && leakFindings[0]!.type === 'PRICE_HIGHER', found);

  const heroAfter = await computeLeakHero(db, rest.id, { now: new Date() });
  const moved = agorot(heroAfter.leakIls) - agorot(heroBefore.leakIls);
  const priceHigher = agorot(Number(leakFindings[0]?.delta ?? 0));
  check('the hero moved by exactly that PRICE_HIGHER', moved === priceHigher && moved > 0, {
    before: heroBefore.leakIls,
    after: heroAfter.leakIls,
    movedIls: moved / 100,
    priceHigherIls: priceHigher / 100,
    spendBefore: heroBefore.spendIls,
    spendAfter: heroAfter.spendIls,
  });

  // ── the cron route ─────────────────────────────────────────────────────────
  const cron = (auth?: string) => fetch(`${BASE}/api/cron/jobs`, { headers: auth ? { authorization: auth } : {} });
  const noAuth = await cron();
  const wrong = await cron('Bearer wrong');
  check('/api/cron/jobs without / with a wrong bearer → 401', noAuth.status === 401 && wrong.status === 401, [noAuth.status, wrong.status]);
  const ok = await cron(`Bearer ${CRON_SECRET}`);
  const body = (await ok.json()) as Record<string, unknown>;
  check('/api/cron/jobs with the bearer → 200', ok.status === 200 && body.ok === true, { status: ok.status, body });
  const [beat] = await sql<Array<{ worker_id: string; host: string; beat_at: Date }>>`
    SELECT worker_id, host, beat_at FROM worker_heartbeats WHERE worker_id = 'vercel-cron'`;
  check('heartbeat written as vercel-cron', !!beat && Date.now() - beat.beat_at.getTime() < 60_000, beat);

  const failed = checks.filter((c) => !c.ok);
  console.log(JSON.stringify({ result: failed.length ? 'FAIL' : 'PASS', base: BASE, poId: po.id, invoiceId: inv!.id, checks }, null, 2));
  return failed.length ? 1 : 0;
}

main()
  .then(async (code) => {
    await sql.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await sql.end().catch(() => {});
    process.exit(1);
  });
