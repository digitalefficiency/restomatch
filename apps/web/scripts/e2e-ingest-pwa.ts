/**
 * Layer-2 functional check for S13 (invoice ingestion + receiver PWA).
 *
 *   PHASE=prod  — against `next build && next start` (NODE_ENV=production):
 *                 every role that can reach the change, in he AND en: HTTP < 400,
 *                 <html lang/dir>, zero console errors, zero 5xx; inbox content;
 *                 role gate; the webhook routes' HTTP rejections; flag-off
 *                 invisibility; mobile receiver: manifest, service worker scope,
 *                 offline banner, offline photo queued in IndexedDB, SW offline page.
 *   PHASE=dev   — against `next dev` (local disk storage exists only outside
 *                 production): webhooks → stored → invoice registered; approve
 *                 from the inbox; offline photo queued then uploaded on reconnect
 *                 (invoice registered once, queue empty).
 *
 *   PHASE=prod E2E_BASE_URL=http://localhost:3000 DATABASE_URL=… PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     pnpm --filter @restomatch/web exec tsx scripts/e2e-ingest-pwa.ts
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { signMeta } from '@restomatch/ingest';

const PHASE = process.env.PHASE === 'dev' ? 'dev' : 'prod';
const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DB_URL = process.env.DATABASE_URL ?? '';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const SHOTS = resolve(process.cwd(), '../../docs/client-ready/screenshots');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) throw new Error('DATABASE_URL must be a LOCAL database');
const sql = postgres(DB_URL, { max: 2 });

let checks = 0;
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  checks += 1;
  console.log(`  ✓ ${msg}`);
}

type Locale = 'he' | 'en';
const ROLES = ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'] as const;
type Role = (typeof ROLES)[number];
const email = (r: Role) => `${r}@kfar-hazeitim.test`;

interface Watch {
  errors: string[];
  serverErrors: string[];
}
function watch(page: Page): Watch {
  const w: Watch = { errors: [], serverErrors: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Deliberate network failures while the test is offline are not app errors.
    if (/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR_/.test(text)) return;
    w.errors.push(text);
  });
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) w.serverErrors.push(`${r.status()} ${r.url()}`);
  });
  return w;
}

async function login(context: BrowserContext, role: Role, locale: Locale): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}/login?lang=${locale}`);
  const form = page.locator('form').filter({ has: page.locator('input[name="password"]') });
  await form.locator('input[name="email"]').fill(email(role));
  await form.locator('input[name="password"]').fill(PASSWORD);
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 120_000 }), form.locator('button[type="submit"]').click()]);
  return page;
}

async function dismissCookies(page: Page) {
  const btn = page.getByRole('button', { name: /^(רק חיוניות|Essential only)$/ });
  if (await btn.count()) await btn.first().click().catch(() => null);
}

async function expectPage(page: Page, path: string, locale: Locale) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 180_000 });
  check(res && res.status() < 400, `${path} [${locale}] HTTP ${res?.status()}`);
  const lang = await page.locator('html').getAttribute('lang');
  const dir = await page.locator('html').getAttribute('dir');
  check(lang === locale && dir === (locale === 'he' ? 'rtl' : 'ltr'), `${path} [${locale}] <html lang=${lang} dir=${dir}>`);
}

async function restaurantId(): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select id from restaurants where name = 'כפר הזיתים' limit 1`;
  return r!.id;
}

async function openPoId(rid: string): Promise<string> {
  const [po] = await sql<{ id: string }[]>`
    select id from purchase_orders where restaurant_id = ${rid} and status in ('sent','confirmed')
    order by expected_delivery_at nulls last limit 1`;
  return po!.id;
}

async function queueCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((res) => {
        const req = indexedDB.open('restomatch-receiver', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'clientUploadId' });
        req.onsuccess = () => {
          const c = req.result.transaction('photos', 'readonly').objectStore('photos').count();
          c.onsuccess = () => {
            req.result.close();
            res(c.result);
          };
        };
        req.onerror = () => res(-1);
      }),
  );
}

/* ── PROD phase ──────────────────────────────────────────────────────────── */

async function prodRolesAndLocales(browser: Browser) {
  for (const locale of ['he', 'en'] as const) {
    for (const role of ROLES) {
      console.log(`\n[prod] ${role} / ${locale}`);
      const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await login(context, role, locale);
      const w = watch(page);
      const canInbox = role === 'owner' || role === 'manager' || role === 'bookkeeper';
      const nav = page.locator('a[href="/dashboard/inbox"]');
      await expectPage(page, '/dashboard', locale);
      check((await nav.count()) > 0 === canInbox, `${role}: inbox nav link ${canInbox ? 'shown' : 'hidden'}`);
      if (canInbox) {
        await expectPage(page, '/dashboard/inbox', locale);
        const msgs = await page.getByTestId('ingest-message').count();
        check(msgs >= 4, `${role}: inbox lists ${msgs} received messages`);
        const title = locale === 'he' ? 'תיבת חשבוניות' : 'Invoice inbox';
        check(await page.getByRole('heading', { name: title }).first().isVisible(), `${role}: inbox title "${title}"`);
        const manage = await page.getByRole('button', { name: locale === 'he' ? 'דחייה' : 'Reject' }).count();
        check(role === 'bookkeeper' ? manage === 0 : manage > 0, `${role}: review buttons ${role === 'bookkeeper' ? 'hidden (read-only)' : 'shown'}`);
        if (role === 'owner') {
          await dismissCookies(page);
          await page.screenshot({ path: join(SHOTS, `ingest-inbox-${locale}.png`) });
          await page.locator('[data-testid="ingest-channels"]').scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(SHOTS, `ingest-settings-${locale}.png`) });
          await page.goto(`${BASE}/dashboard/inbox?filter=errors`, { waitUntil: 'networkidle' });
          const err = locale === 'he' ? 'סוג קובץ לא נתמך' : 'Unsupported file type';
          check(await page.getByText(err).first().isVisible(), `owner: error filter shows "${err}"`);
        }
      } else {
        await page.goto(`${BASE}/dashboard/inbox`, { waitUntil: 'networkidle' });
        check(!page.url().includes('/dashboard/inbox'), `${role}: /dashboard/inbox is role-gated (→ ${new URL(page.url()).pathname})`);
      }
      if (role === 'owner' || role === 'manager' || role === 'receiver') {
        await expectPage(page, '/dashboard/receiving', locale);
        check((await page.locator('link[rel="manifest"]').getAttribute('href')) === '/pwa/manifest.webmanifest', `${role}: receiving page links the PWA manifest`);
      }
      check(w.serverErrors.length === 0, `${role}/${locale}: zero server 5xx (${w.serverErrors.join(', ')})`);
      check(w.errors.length === 0, `${role}/${locale}: zero console errors (${w.errors.join(' | ').slice(0, 400)})`);
      await context.close();
    }
  }
}

async function prodWebhookHttp(rid: string) {
  console.log('\n[prod] webhook HTTP rejections');
  const [ch] = await sql<{ id: string }[]>`select id from ingest_channels where restaurant_id = ${rid} and kind = 'whatsapp' and active`;
  check(ch, 'demo restaurant has a live WhatsApp channel (from ingest-simulate)');
  const fake = `wa_${'0'.repeat(32)}`;
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const forged = await fetch(`${BASE}/api/ingest/whatsapp/${fake}`, {
    method: 'POST',
    headers: { 'x-hub-signature-256': signMeta(body, 'attacker-secret'), 'content-type': 'application/json' },
    body,
  });
  check(forged.status === 401, `forged signature → ${forged.status}`);
  const big = await fetch(`${BASE}/api/ingest/whatsapp/${fake}`, { method: 'POST', body: 'x'.repeat(300 * 1024) });
  check(big.status === 413, `oversized body → ${big.status}`);
  const valid = await fetch(`${BASE}/api/ingest/whatsapp/${fake}`, {
    method: 'POST',
    headers: { 'x-hub-signature-256': signMeta(body, process.env.WHATSAPP_APP_SECRET ?? ''), 'content-type': 'application/json' },
    body,
  });
  check(valid.status === 404, `valid signature + unknown token → ${valid.status}`);
  const anon = await fetch(`${BASE}/api/trpc/ingest.inbox`);
  check(anon.status === 401, `anonymous ingest.inbox → ${anon.status}`);
}

async function prodFlagOff(browser: Browser, rid: string) {
  console.log('\n[prod] flags off → invisible');
  const [row] = await sql<{ settings: postgres.JSONValue }[]>`select settings from restaurants where id = ${rid}`;
  const settings = row!.settings;
  const off = { ...(settings as Record<string, postgres.JSONValue>), features: {} };
  await sql`update restaurants set settings = ${sql.json(off)} where id = ${rid}`;
  try {
    const context = await browser.newContext();
    const page = await login(context, 'owner', 'he');
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    check((await page.locator('a[href="/dashboard/inbox"]').count()) === 0, 'flag off: inbox nav hidden');
    // notFound() after the dashboard layout started streaming keeps HTTP 200
    // (Next.js) but renders the 404 UI with noindex — assert what the user sees.
    const res = await page.goto(`${BASE}/dashboard/inbox`, { waitUntil: 'networkidle' });
    const notFoundUi =
      (await page.getByTestId('ingest-messages').count()) === 0 &&
      (await page.getByTestId('ingest-channels').count()) === 0 &&
      (await page.getByText('404', { exact: true }).count()) > 0;
    check(notFoundUi && (res?.status() ?? 500) < 500, `flag off: /dashboard/inbox renders the 404 page (HTTP ${res?.status()}), no inbox data`);
    await page.goto(`${BASE}/dashboard/receiving`, { waitUntil: 'networkidle' });
    check((await page.locator('link[rel="manifest"]').count()) === 0, 'flag off: no PWA manifest on receiving');
    await context.close();
  } finally {
    await sql`update restaurants set settings = ${sql.json(settings)} where id = ${rid}`;
  }
}

async function mobileReceiver(browser: Browser, rid: string, locale: Locale, expectDrain: boolean) {
  console.log(`\n[${PHASE}] mobile receiver offline queue / ${locale}`);
  const poId = await openPoId(rid);
  const context = await browser.newContext({
    serviceWorkers: 'allow',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  });
  const page = await login(context, 'receiver', locale);
  const w = watch(page);
  await expectPage(page, '/dashboard/receiving?source=pwa', locale);
  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
  check(scope.endsWith('/dashboard/receiving'), `service worker controls scope ${new URL(scope).pathname}`);
  check((await page.locator('html').getAttribute('data-pwa')) === 'installed', 'installed mode (?source=pwa) → large touch targets');
  const manifest = await (await page.request.get(`${BASE}/pwa/manifest.webmanifest`)).json();
  check(manifest.scope === '/dashboard/receiving' && manifest.icons.length === 3, 'manifest served with scope + 3 icons');

  await expectPage(page, `/dashboard/receiving/${poId}`, locale);
  const invoicesBefore = Number((await sql`select count(*)::int as n from invoices where restaurant_id = ${rid}`)[0]!.n);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const banner = page.getByTestId('pwa-offline-banner');
  await banner.waitFor({ timeout: 10_000 });
  check(
    (await banner.innerText()).includes(locale === 'he' ? 'אין חיבור לאינטרנט' : 'You are offline'),
    `offline banner in ${locale}`,
  );
  await page.locator('input[type="file"]').setInputFiles({ name: 'invoice.png', mimeType: 'image/png', buffer: PNG });
  for (let i = 0; i < 30 && (await queueCount(page)) < 1; i += 1) await page.waitForTimeout(500);
  check((await queueCount(page)) === 1, 'offline photo stored in IndexedDB (1 queued)');
  await page.getByRole('button', { name: locale === 'he' ? /עבד את החשבונית/ : /Process invoice/ }).click();
  const saved = locale === 'he' ? 'התמונה נשמרה בטלפון' : 'Photo saved on the phone';
  await page.getByText(saved).first().waitFor({ timeout: 10_000 });
  check(true, `wizard tells the receiver the photo is saved offline ("${saved}")`);
  await page.getByTestId('pwa-queue-count').waitFor({ timeout: 10_000 }).catch(() => null);
  await dismissCookies(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SHOTS, `pwa-offline-${locale}.png`), fullPage: false });

  // Offline navigation inside the scope → the SW's static offline page (never cached HTML).
  // setOffline() does not reach the service worker's own fetches in Chromium, so
  // also abort network requests at the context level (that does cover the SW).
  const offlineRoute = (route: import('@playwright/test').Route) => route.abort('internetdisconnected');
  await context.route(`${BASE}/dashboard/**`, offlineRoute);
  await page.goto(`${BASE}/dashboard/receiving`).catch(() => null);
  const offlineText = await page.locator('body').innerText().catch(() => '');
  if (!/You are offline/.test(offlineText)) console.log('    [debug] url', page.url(), JSON.stringify(offlineText.slice(0, 300)));
  check(/אין חיבור לאינטרנט/.test(offlineText) && /You are offline/.test(offlineText), 'offline navigation → SW offline page (he + en)');
  await page.screenshot({ path: join(SHOTS, `pwa-offline-page-${locale}.png`), fullPage: false });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls: string[] = [];
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return urls.sort();
  });
  check(
    JSON.stringify(cached) ===
      JSON.stringify(['/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/icon-maskable-512.png', '/pwa/manifest.webmanifest', '/pwa/offline.html']),
    `Cache Storage holds ONLY the public PWA files: ${cached.join(', ')}`,
  );

  console.log('    [debug] queued before reconnect:', await queueCount(page).catch((e) => String(e)));
  page.on('console', (m) => { if (!m.text().includes('Report Only')) console.log('    [browser]', m.type(), m.text().slice(0, 300)); });
  page.on('response', (r) => { if (r.url().includes('/api/trpc/')) console.log('    [trpc]', r.status(), new URL(r.url()).pathname); });
  await context.unroute(`${BASE}/dashboard/**`, offlineRoute);
  await context.setOffline(false);
  await page.goto(`${BASE}/dashboard/receiving/${poId}`, { waitUntil: 'networkidle' });
  if (expectDrain) {
    let left = await queueCount(page);
    for (let i = 0; i < 60 && left !== 0; i += 1) {
      await page.waitForTimeout(1000);
      left = await queueCount(page);
    }
    check(left === 0, `back online → queue drained (${left} left)`);
    const after = Number((await sql`select count(*)::int as n from invoices where restaurant_id = ${rid}`)[0]!.n);
    check(after === invoicesBefore + 1, `exactly ONE invoice registered from the queued photo (${invoicesBefore} → ${after})`);
    await page.reload({ waitUntil: 'networkidle' });
    const again = Number((await sql`select count(*)::int as n from invoices where restaurant_id = ${rid}`)[0]!.n);
    check(again === after, 'a later sync does not register it twice');
  } else {
    // Production build without object storage: upload is refused server-side,
    // so the photo must STAY queued (never lost) and the receiver sees why.
    await page.waitForTimeout(3000);
    check((await queueCount(page)) === 1, 'prod build without storage: photo stays queued (not lost) after a refused upload');
    // S4 I3, flipped (decision 22 default: keep and attribute). Leaving never
    // wipes an unsent photo: it stays on this device and uploads — attributed
    // ("צולם על ידי") — with the next signed-in user of this branch.
    // NOTE: the expired-session case needs /login's PwaQueueReset to stop
    // clearing the queue (W1-09's file); until then this check fails by design.
    if (locale === 'he') {
      await context.clearCookies();
      await page.goto(`${BASE}/dashboard/receiving`, { waitUntil: 'networkidle' });
      check(new URL(page.url()).pathname.startsWith('/login'), 'expired session → /login');
      await page.waitForTimeout(1500);
      check((await queueCount(page)) === 1, 'session-expired redirect to /login keeps the unsent photo on the device');
    } else {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('button', { name: 'Sign out' }).last().click();
      // The upload is refused here, so the sign-out guard asks: keep it on the phone and sign out.
      await page.getByTestId('logout-keep').click();
      await page.waitForURL((u) => !u.pathname.startsWith('/dashboard'), { timeout: 30_000 });
      await page.waitForTimeout(1500);
      check((await queueCount(page)) === 1, 'sign-out keeps the unsent photo on the device (uploads attributed later)');
    }
  }
  check(w.serverErrors.filter((e) => !/\/api\/trpc\/scans\.upload/.test(e)).length === 0, `mobile/${locale}: zero unexpected 5xx`);
  await context.close();
}

/* ── DEV phase ───────────────────────────────────────────────────────────── */

async function devApprove(browser: Browser, rid: string) {
  console.log('\n[dev] pipeline: stored + registered, approve from the inbox');
  const docs = await sql<{ status: string; storage_path: string | null; invoice_id: string | null }[]>`
    select status, storage_path, invoice_id from ingest_documents where restaurant_id = ${rid}`;
  check(docs.some((d) => d.status === 'registered' && d.invoice_id), 'allow-listed WhatsApp photo → invoice registered');
  check(docs.filter((d) => d.status === 'needs_review').every((d) => d.storage_path?.startsWith(`${rid}/`)), 'review documents stored under the restaurant prefix');
  const [src] = await sql<{ source: string; status: string }[]>`
    select i.source, i.status from invoices i join ingest_documents d on d.invoice_id = i.id
    where d.restaurant_id = ${rid} and d.status = 'registered' limit 1`;
  check(src?.source === 'whatsapp' && src.status !== undefined, `registered invoice has source=${src?.source}`);

  const context = await browser.newContext();
  const page = await login(context, 'manager', 'en');
  await page.goto(`${BASE}/dashboard/inbox?filter=needs_review`, { waitUntil: 'networkidle' });
  const before = await page.getByTestId('ingest-document').count();
  await page.getByRole('button', { name: 'Approve and read' }).first().click();
  await page.getByText('The document was sent for reading').waitFor({ timeout: 20_000 });
  let after = before;
  for (let i = 0; i < 40 && after === before; i += 1) {
    await page.waitForTimeout(500);
    after = await page.getByTestId('ingest-document').count();
  }
  check(after === before - 1, `approve: needs-review list ${before} → ${after}`);
  await page.goto(`${BASE}/dashboard/inbox`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create address' }).first().click().catch(() => null);
  await page.getByRole('button', { name: 'Replace address' }).first().click().catch(() => null);
  const fresh = page.getByTestId('ingest-fresh-secret');
  await fresh.waitFor({ timeout: 15_000 });
  check(/(wa|inv)_[0-9a-f]{32}/.test(await fresh.innerText()), 'rotate shows the new secret address once');
  await page.screenshot({ path: join(SHOTS, 'ingest-inbox-rotate-en.png'), fullPage: true });
  await context.close();
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch(
    process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  );
  const rid = await restaurantId();
  try {
    if (PHASE === 'prod') {
      await prodRolesAndLocales(browser);
      await prodWebhookHttp(rid);
      await prodFlagOff(browser, rid);
      await mobileReceiver(browser, rid, 'he', false);
      await mobileReceiver(browser, rid, 'en', false);
    } else {
      await devApprove(browser, rid);
      await mobileReceiver(browser, rid, 'en', true);
    }
    console.log(`\nPASS (${PHASE}): ${checks} checks`);
  } finally {
    await browser.close();
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
