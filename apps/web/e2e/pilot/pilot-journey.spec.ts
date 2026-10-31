/**
 * Pilot journey — a brand-new, EMPTY restaurant from first login to a claims letter
 * (docs/PILOT-QA.md). Stage A: scripts/pilot-lab.sh (local lab). Stage C: PILOT_PROBE=write —
 * the same steps on production's QA tenant, Rom only, behind assertQaTenant (every login).
 *
 * Office roles use a 1440 desktop context, the receiver a Pixel 7 context. The steps run in
 * order and share state (the suppliers, catalog and order the owner creates are what the
 * receiver receives). Steps that wait on an unmerged PR are test.fixme with the PR named.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  CHEF_CAN_CREATE_ORDERS,
  DESKTOP,
  LAB,
  PROBE,
  PIXEL_7,
  QA_TENANT_NAME,
  TERMINOLOGY,
  answerCookieBanner,
  assertQaTenant,
  expectSingleBranch,
  expectMoneyRightAligned,
  expectNoHorizontalOverflow,
  expectNoShekel,
  expectNoTarget,
  loadFacts,
  main,
  mainText,
  newContext,
  shot,
  signIn,
  watchErrors,
  type Facts,
  type Role,
} from './support';

// The shared apps/web/playwright.config.ts globs e2e/**: these run only via playwright.pilot.config.ts.
test.skip(!process.env.PILOT_SUITE, 'pilot suite: run with -c e2e/pilot/playwright.pilot.config.ts');
// In order (one worker, file order) but NOT serial: a red step must not hide the steps after it.
test.describe.configure({ mode: 'default' });

const HERE = dirname(fileURLToPath(import.meta.url));

/** Steps waiting on a named PR (flip to false when it is on the tested tree). */
const WAITS = {
  /** W1-06 follow-up: client-side shrink of a phone photo before upload (6 MB JPEG). */
  uploadShrink: 'W1-06 image shrink (6 MB phone photo) — not on main + #167',
  /** S2: manual invoice lines — the only way a non-demo tenant gets findings without OCR. */
  manualLines: "S2's manual invoice lines (#216) — without them a fresh tenant has no invoice lines, so no findings",
  /** W1-11: open order writes to the chef (route, nav entry, server: managerProcedure today). */
  chefOrders: 'W1-11 chef order writes (route + nav + server) — not on main + #167',
} as const;
/**
 * Waiting PRs that are on the tested tree: list them in MERGED_ON_MAIN once they merge, or name them in
 * PILOT_ON_TREE (comma list) to run a lab built from their branch, e.g. PILOT_ON_TREE=w1-06.
 */
const MERGED_ON_MAIN: readonly string[] = []; // add 'w1-06' / 's2' / 'w1-11' as they merge
const ON_TREE = new Set([...MERGED_ON_MAIN, ...(process.env.PILOT_ON_TREE ?? '').split(',').map((s) => s.trim().toLowerCase())]);
/** W1-06's photo shrink (#210) → step 5b runs. */
const UPLOAD_SHRINK_ON_TREE = ON_TREE.has('w1-06');
/** S2's manual invoice lines (#216) → steps 11, 8 and 9 run. */
const MANUAL_LINES_ON_TREE = ON_TREE.has('s2');
/** W1-11's chef ordering → step 7b runs. */
const CHEF_ORDERS_ON_TREE = ON_TREE.has('w1-11');

/** Stage C re-runs on one long-lived tenant: tag the names so each run's rows are its own. */
const RUN_ID = process.env.PILOT_RUN_ID ?? 'adhoc';
const RUN_TAG = PROBE === 'write' ? ` QA-${RUN_ID.slice(4, 12)}` : '';
const SUPPLIER_PRODUCE = `ירקות לב השרון${RUN_TAG}`;
const SUPPLIER_DAIRY = `מחלבת הגליל העליון${RUN_TAG}`;
/** Hebrew headers, Excel-style BOM, and a thousands separator inside a quoted cell. */
const PRICE_LIST_CSV =
  '﻿שם מוצר,מחיר,יחידה,מק״ט\nעגבניה שרי,12.90,ק״ג,T-1\nשמן זית 18 ליטר,"1,250",יח׳,O-18\nבצל יבש,3.20,ק״ג,B-3\n';
/** The decided term is "מרכזת"; "ריכוז" on a screen is the old wording. */
const OLD_CONSOLIDATED_TERM = /ריכוז/;

let facts: Facts;
let desk: BrowserContext;
let phone: BrowserContext;
const pages = new Map<Role, Page>();
const errors = new Map<Role, string[]>();
/**
 * Ids the later steps need (the orders the receiver receives). Kept in a per-run file, not only in
 * memory: Playwright starts a fresh worker after a failed step.
 */
const STATE_FILE = resolve(HERE, `../../test-results/pilot/state-${RUN_ID}.json`);
interface JourneyState {
  orderTodayId?: string;
  orderLateId?: string;
  /** Step 11's invoice (OCR did not run; lines entered by hand). */
  invoiceId?: string;
  /** Step 8: the finding approved for a claim (what step 9's letter must carry). */
  claimed?: { amount: string; what: string };
  /** A login landed on a tenant that is not the QA tenant: no further logins this run. */
  refused?: string;
  /** Every screen text visited, for the isolation sweep (no demo supplier names anywhere). */
  visited?: { role: Role; path: string; text: string }[];
}
function state(): JourneyState {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as JourneyState) : {};
}
function remember(patch: JourneyState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ...state(), ...patch }));
}

function israelDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

async function as(role: Role): Promise<Page> {
  const existing = pages.get(role);
  if (existing) return existing;
  // Stage C: chef / bookkeeper are optional QA users — no credentials, no step.
  test.skip(PROBE === 'write' && !process.env[`PILOT_${role.toUpperCase()}_EMAIL`], `PILOT_${role.toUpperCase()}_EMAIL is not set`);
  const ctx = role === 'receiver' ? phone : desk;
  // One browser context per device; roles need their own cookies, so a context per role.
  const own = await ctx.browser()!.newContext({
    ...(role === 'receiver' ? PIXEL_7 : DESKTOP),
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    acceptDownloads: true,
  });
  const page = await own.newPage();
  errors.set(role, watchErrors(page));
  const refused = state().refused;
  if (refused) throw new Error(`[pilot] STOP (earlier in this run): ${refused}`);
  await signIn(page, role, facts);
  // Every login, every stage: the page must be the QA tenant (Stage C also checks the id).
  try {
    await assertQaTenant(page, PROBE === 'write' ? facts.restaurantId : undefined);
  } catch (err) {
    await own.close();
    remember({ refused: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  pages.set(role, page);
  return page;
}

async function visit(page: Page, role: Role, path: string, opts: { forbidden?: boolean } = {}): Promise<string> {
  const res = await page.goto(path);
  expect(res?.status() ?? 0, `${role} ${path} HTTP status`).toBeLessThan(500);
  await page.waitForLoadState('networkidle').catch(() => {});
  if (opts.forbidden) {
    // The role's own 403 page: the browser logs the 403 document as a console error — expected here.
    await expect(page.getByText(/403/).first()).toBeVisible();
    const list = errors.get(role) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (/status of 403/.test(list[i]!)) list.splice(i, 1);
  }
  const text = await mainText(page);
  remember({ visited: [...(state().visited ?? []), { role, path, text }] });
  return text;
}

function expectCleanConsole(role: Role, where: string): void {
  const list = errors.get(role) ?? [];
  expect(list, `${where}: console errors`).toEqual([]);
  list.length = 0;
}

/** Lab only: run an e2e/pilot/lab.ts command against the lab database; returns its stdout. */
function labTool(...args: string[]): string {
  const db = process.env.PILOT_LAB_DATABASE_URL;
  if (!db) throw new Error('PILOT_LAB_DATABASE_URL is not set (scripts/pilot-lab.sh sets it)');
  return execFileSync('pnpm', ['--filter', '@restomatch/db', 'exec', 'tsx', resolve(HERE, 'lab.ts'), ...args], {
    cwd: resolve(HERE, '../../../..'),
    env: { ...process.env, DATABASE_URL: db },
    encoding: 'utf8',
  });
}

/** Lab only: move an order's expected delivery into the past (the UI refuses past dates). */
function backdate(poId: string, days: number): void {
  labTool('backdate', poId, String(days));
}

test.beforeAll(async ({ browser }) => {
  if (PROBE === 'write') {
    if (!process.env.PILOT_TENANT_CONFIRM) throw new Error('[pilot] Stage C needs PILOT_TENANT_CONFIRM = the QA restaurant id');
    if (!process.env.PILOT_OWNER_EMAIL) throw new Error('[pilot] Stage C reads QA credentials from PILOT_<ROLE>_EMAIL / _PASSWORD');
  } else if (!LAB) {
    throw new Error('[pilot] Stage A runs through scripts/pilot-lab.sh (PILOT_LAB_DATABASE_URL is not set)');
  }
  facts = loadFacts();
  desk = await newContext(browser, DESKTOP);
  phone = await newContext(browser, PIXEL_7);
});

test.afterAll(async () => {
  for (const p of pages.values()) await p.context().close();
  await desk?.close();
  await phone?.close();
});

test('1 · owner signs in with a password → empty states, ₪0, no target', async ({}, info) => {
  const page = await as('owner');
  await expect(page).toHaveURL(/\/dashboard/);
  const text = await visit(page, 'owner', '/dashboard');
  if (LAB) {
    // A brand-new tenant (Stage C re-runs on a used one, so the empty state is lab-only).
    expect(text).toMatch(/0\s?₪|₪\s?0/);
    expect(text, 'empty home invites the first invoice').toContain('עוד לא נבדקו חשבוניות');
  }
  await expectNoTarget(page, 'owner home');
  await expectMoneyRightAligned(page, 'owner home');
  await expectNoHorizontalOverflow(page, 'owner home');
  expect(text, 'the QA tenant has no demo data').not.toContain('כפר הזיתים');
  await shot(page, info, '1-owner-home');
  expectCleanConsole('owner', 'owner home');
});

test('2 · owner adds two suppliers (one should be VAT 0%)', async ({}, info) => {
  const page = await as('owner');
  await visit(page, 'owner', '/dashboard/suppliers');
  for (const [name, biz] of [
    [SUPPLIER_PRODUCE, '514000012'],
    [SUPPLIER_DAIRY, '514000020'],
  ] as const) {
    await main(page).getByRole('button', { name: 'ספק חדש' }).first().click();
    await page.locator('#sup-name').fill(name);
    await page.locator('#sup-biz').fill(biz);
    // Delivers every day, so today's order has a delivery day.
    for (const d of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) await page.locator(`#sup-day-${d}`).check();
    await main(page).getByRole('button', { name: 'שמירה' }).click();
    await expect(page.getByText(`הספק "${name}" נוסף.`).first()).toBeVisible();
  }
  const text = await visit(page, 'owner', '/dashboard/suppliers');
  expect(text).toContain(SUPPLIER_PRODUCE);
  expect(text).toContain(SUPPLIER_DAIRY);
  await expectNoTarget(page, 'suppliers');
  await shot(page, info, '2-suppliers');
  // Produce suppliers are VAT-exempt. The supplier form has no VAT field on main + #167, and the
  // suppliers API takes no vatRate: only pilot-setup (config "vatRate": 0) sets it. Recorded, not faked.
  info.annotations.push({
    type: 'gap',
    description: 'No UI to set a supplier VAT rate (0% produce). Set via pilot-setup config only.',
  });
  expectCleanConsole('owner', 'suppliers');
});

test('3 · catalog import from a Hebrew-header CSV — "1,250" becomes ₪1,250', async ({}, info) => {
  const page = await as('owner');
  await visit(page, 'owner', '/dashboard/catalog/import');
  await page.locator('#imp-supplier').selectOption({ label: SUPPLIER_PRODUCE });
  await main(page).getByRole('button', { name: 'המשך' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'מחירון.csv', mimeType: 'text/csv', buffer: Buffer.from(PRICE_LIST_CSV, 'utf8') });
  await main(page).getByRole('button', { name: 'ניתוח הקובץ' }).click();
  await expect(main(page)).toContainText('זוהו 3 שורות');
  // Hebrew headers map themselves.
  await expect(page.locator('#map-name')).toHaveValue('שם מוצר');
  await expect(page.locator('#map-price')).toHaveValue('מחיר');
  expect(await mainText(page), 'the "1,250" cell reads as ₪1,250.00').toMatch(/שמן זית 18 ליטר[^\n]*1,250\.00\s?₪/);
  await page.getByLabel('לא כולל מע״מ').check();
  await main(page).getByRole('button', { name: /^ייבוא 3 שורות/ }).click();
  await expect(main(page)).toContainText('הייבוא הושלם — 3 שורות');
  const text = await visit(page, 'owner', '/dashboard/catalog');
  expect(text).toMatch(/שמן זית 18 ליטר[\s\S]*1,250\.00\s?₪/);
  await expectMoneyRightAligned(page, 'catalog');
  await shot(page, info, '3-catalog');
  expectCleanConsole('owner', 'catalog');
});

async function placeRecordOnlyOrder(page: Page, date: string, role: Role = 'owner'): Promise<string> {
  await visit(page, role, '/dashboard/orders/new');
  await main(page).getByRole('button', { name: SUPPLIER_PRODUCE }).click();
  await main(page).getByRole('button', { name: /^עגבניה שרי/ }).click();
  await main(page).getByRole('button', { name: /^שמן זית 18 ליטר/ }).click();
  await main(page).getByText('תאריך אחר', { exact: true }).click();
  await page.locator('#ord-delivery-date').fill(date);
  await main(page).getByRole('button', { name: 'המשך לסקירה' }).click();
  await page.locator('#ord-channel').selectOption('none');
  // "סמנו כנשלחה…" on main + #167; "רשמו במערכת…" once W1-11 lands.
  await page.getByRole('button', { name: /^(סמנו כנשלחה|רשמו במערכת)/ }).click();
  // Send-with-undo: a 10 s countdown, then the confirmation.
  await expect(main(page)).toContainText(/ההזמנה סומנה כנשלחה|נרשמה במערכת/, { timeout: 30_000 });
  await expect(main(page)).toContainText(/לא נשלח דבר לספק|לא נשלחה לספק/);
  const confirmation = await mainText(page);
  expect(confirmation, 'record-only must never claim it went out').not.toMatch(/בתור לשליחה|נשלחה ב(?:וואטסאפ|אימייל)/);
  await main(page).getByRole('link', { name: 'צפייה בהזמנה' }).click();
  await page.waitForURL(/\/dashboard\/orders\/[0-9a-f-]{36}/);
  await expect(main(page).getByRole('heading', { name: new RegExp(SUPPLIER_PRODUCE) }).first()).toBeVisible();
  return page.url().split('/').pop()!;
}

test('4 · a "ללא שליחה" (record only) order never says it was sent', async ({}, info) => {
  const page = await as('owner');
  const orderTodayId = await placeRecordOnlyOrder(page, israelDate(0));
  remember({ orderTodayId });
  const detail = await mainText(page);
  const sendStatus = page.getByTestId('send-status'); // W1-11: the send state, machine-readable
  if ((await sendStatus.count()) > 0) await expect.soft(sendStatus.first(), 'send state of a record-only order').toHaveAttribute('data-state', 'none');
  await shot(page, info, '4-order-detail');
  const orderLateId = await placeRecordOnlyOrder(page, israelDate(0));
  remember({ orderLateId });
  if (LAB) backdate(orderLateId, 1);
  // The detail page is where "sent" copy would mislead the owner later (soft: setup above must finish).
  // "נשלחה" (sent) is wrong here; "לא נשלחה" (not sent) / "נרשמה" (recorded) is right.
  expect.soft(detail, 'order page: status copy says "sent" for a record-only order').not.toMatch(/(?<!לא )נשלחה/);
  expectCleanConsole('owner', 'orders');
});

test('5 · receiver on the phone: today + late POs → Delivery Check → close', async ({}, info) => {
  const page = await as('receiver');
  const home = await visit(page, 'receiver', '/dashboard');
  await expectNoHorizontalOverflow(page, 'receiver home');
  await shot(page, info, '5-receiver-board');
  expect(home).toContain(SUPPLIER_PRODUCE);
  if (LAB) {
    expect(home, 'board shows the late PO').toMatch(/באיחור|late/i);
  }
  const { orderTodayId } = state();
  expect(orderTodayId, "step 4's order (state file)").toBeTruthy();
  // From the board, like the receiver at the door: the order's own "start receiving" link.
  await page.locator(`a[href*="/dashboard/receiving/${orderTodayId}"]`).first().click();
  await page.waitForURL(new RegExp(`/dashboard/receiving/${orderTodayId}`));
  // The wizard renders in Hebrew, then hydrates into the receiver's own language (en): a click
  // during that switch is lost, so click once the page is idle and re-try until the count shows.
  await page.waitForLoadState('networkidle').catch(() => {});
  const noInvoice = page.getByRole('button', { name: /אין חשבונית עכשיו|No invoice right now/i });
  const deliveryCheck = main(page).getByText(/Delivery check|בדיקת משלוח/i).first();
  await expect(async () => {
    if (!(await deliveryCheck.isVisible())) await noInvoice.click({ timeout: 2_000 });
    await expect(deliveryCheck).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  const arrived = main(page).getByRole('button', { name: /^(Arrived|הגיע)/ });
  // A pressed "Arrived" keeps its name, so walk the lines by index, not .first().
  const lines = await arrived.count();
  expect(lines, 'Delivery Check lists the ordered lines').toBeGreaterThan(0);
  for (let i = 0; i < lines; i++) {
    await arrived.nth(i).click();
    await expect(arrived.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(main(page).getByRole('progressbar')).toHaveAccessibleName(new RegExp(`${lines} (of|מתוך) ${lines}`));
  await expectNoShekel(page, 'Delivery Check');
  await shot(page, info, '5-delivery-check');
  await main(page).getByRole('button', { name: /Close the receipt|סגירת הקבלה/ }).click();
  await expect(main(page)).toContainText(/Receipt closed|הקבלה נסגרה/i, { timeout: 30_000 });
  await shot(page, info, '5-receipt-closed');
  expectCleanConsole('receiver', 'receiving');
});

/** A real, decodable ~6 MB 4000×3000 JPEG (a phone camera's size), made by the browser. */
async function sixMegabyteJpeg(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000;
    c.height = 3000;
    const g = c.getContext('2d')!;
    const img = g.createImageData(c.width, c.height);
    let seed = 1; // deterministic noise: JPEG can't compress it away
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = (seed >> 8) & 255;
      img.data[i] = v;
      img.data[i + 1] = (v * 7) & 255;
      img.data[i + 2] = 255 - v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    let q = 0.5;
    for (let k = 0; k < 10; k++) {
      const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', q));
      if (blob.size > 5.5e6 && blob.size < 7.5e6) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(bin);
      }
      q = blob.size < 5.5e6 ? q + (1 - q) / 2 : q / 1.3;
    }
    return '';
  });
  return Buffer.from(b64, 'base64');
}

test('5b · receiver uploads a 6 MB phone photo of the invoice', async ({}, info) => {
  test.fixme(!UPLOAD_SHRINK_ON_TREE, WAITS.uploadShrink);
  // The late order: step 5 received today's, this one is still open on the board.
  const { orderLateId } = state();
  expect(orderLateId, "step 4's late order (state file)").toBeTruthy();
  const page = await as('receiver');
  await visit(page, 'receiver', '/dashboard/receiving');
  await page.locator(`a[href*="/dashboard/receiving/${orderLateId}"]`).first().click();
  await page.waitForURL(new RegExp(`/dashboard/receiving/${orderLateId}`));
  await page.waitForLoadState('networkidle').catch(() => {});
  const photo = await sixMegabyteJpeg(page);
  expect(photo.length, 'test photo is phone-sized (> 5.5 MB)').toBeGreaterThan(5.5e6);

  // Pick the photo; a pick during hydration is lost, so re-pick until the upload request goes out.
  let upload: import('@playwright/test').Response | undefined;
  await expect(async () => {
    const res = page.waitForResponse((r) => r.url().includes('/api/trpc/scans.upload'), { timeout: 8_000 });
    await page.getByTestId('scan-input').setInputFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo });
    upload = await res;
  }).toPass({ timeout: 45_000 });
  const sent = upload!.request().postDataBuffer()?.length ?? 0;
  info.annotations.push({ type: 'upload', description: `${(photo.length / 1e6).toFixed(2)} MB photo → ${(sent / 1e6).toFixed(2)} MB request` });
  // Shrunk in the browser, before any request: under Vercel's 4.5 MB body limit (base64 included).
  expect(sent, 'upload request body (bytes)').toBeLessThan(4.5 * 1024 * 1024);
  expect(sent, 'the photo was re-encoded, not sent as is').toBeLessThan(photo.length);
  const body = await upload!.text();
  expect(body, 'the server refused the upload size').not.toMatch(/PAYLOAD_TOO_LARGE|too_big|BAD_REQUEST/);
  await shot(page, info, '5b-photo-upload');

  if (LAB) {
    // The lab's scan storage is a placeholder Supabase: the upload stops there (500). What W1-06
    // promises — shrink first, never fail at the back door on size — is what this step proves.
    info.annotations.push({ type: 'lab', description: 'scan storage is a placeholder in the lab: upload ends at storage, not on size' });
    const list = errors.get('receiver') ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (/status of 500/.test(list[i]!)) list.splice(i, 1);
  } else {
    expect(upload!.ok(), `scans.upload ${upload!.status()}`).toBe(true);
    // The invoice this photo became: step 11 enters its lines by hand.
    const registered = page.waitForResponse((r) => r.url().includes('/api/trpc/receiving.registerInvoice'), { timeout: 60_000 });
    await expect(main(page)).not.toContainText(/Upload failed|העלאת הסריקה נכשלה/);
    await page.getByTestId('scan-process').click();
    const reg = (await (await registered).json().catch(() => null)) as Array<{ result?: { data?: { json?: { invoiceId?: string } } } }> | null;
    const invoiceId = reg?.[0]?.result?.data?.json?.invoiceId;
    expect(invoiceId, 'registerInvoice returned the invoice id').toBeTruthy();
    remember({ invoiceId });
    // No ANTHROPIC_API_KEY for a non-demo tenant: a calm "not read automatically" notice, then the count.
    await expect(
      main(page).getByText(/קריאה אוטומטית אינה פעילה|Automatic reading is off|Delivery check|בדיקת משלוח|Reading|קוראים/i).first(),
    ).toBeVisible({ timeout: 60_000 });
    await shot(page, info, '5b-after-upload');
  }
  expectCleanConsole('receiver', 'photo upload');
});

test('6 · receiver home, receiving and invoices show no ₪', async ({}, info) => {
  const page = await as('receiver');
  for (const path of ['/dashboard', '/dashboard/receiving', '/dashboard/inbox']) {
    await visit(page, 'receiver', path, { forbidden: path === '/dashboard/inbox' });
    await expectNoShekel(page, `receiver ${path}`);
  }
  await shot(page, info, '6-receiver-inbox');
  expectCleanConsole('receiver', 'receiver money sweep');
});

test('7 · chef sees no ₪ and no target', async ({}, info) => {
  const page = await as('chef');
  await visit(page, 'chef', '/dashboard');
  await shot(page, info, '7-chef-home');
  await expectNoShekel(page, 'chef home');
  await expectNoTarget(page, 'chef home');
  expectCleanConsole('chef', 'chef home');
});

test('7b · chef orders per CHEF_CAN_CREATE_ORDERS; ₪ on the orders screens only', async ({}, info) => {
  test.fixme(CHEF_CAN_CREATE_ORDERS !== CHEF_ORDERS_ON_TREE, WAITS.chefOrders);
  const page = await as('chef');
  if (CHEF_CAN_CREATE_ORDERS) {
    // Freely, no manager approval: the record-only order goes straight to "marked sent".
    await placeRecordOnlyOrder(page, israelDate(0), 'chef');
    expect(await mainText(page), 'chef sees totals on the order page').toMatch(/\d\s?₪|₪\s?\d/);
    await shot(page, info, '7b-chef-order');
    expect(await visit(page, 'chef', '/dashboard/orders'), 'chef sees prices on the orders list').toMatch(/\d\s?₪|₪\s?\d/);
    await expect(page.getByRole('navigation').first(), 'order entry in the chef nav').toContainText('הזמנות');
    // …and still no ₪ anywhere else the chef goes.
    await visit(page, 'chef', '/dashboard');
    await expectNoShekel(page, 'chef home (after ordering)');
  } else {
    const res = await page.goto('/dashboard/orders/new');
    await page.waitForLoadState('networkidle').catch(() => {});
    const text = await mainText(page);
    await shot(page, info, '7b-chef-orders-new');
    const refused = (res?.status() ?? 0) === 403 || !page.url().includes('/dashboard/orders/new') || /403|אין גישה|לא פתוח/.test(text);
    expect(refused, 'chef is refused the order wizard').toBe(true);
    const list = errors.get('chef') ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (/status of 403/.test(list[i]!)) list.splice(i, 1);
  }
  expectCleanConsole('chef', 'chef orders');
});

test('11 · an OCR-failed invoice gets manual lines (runs before 8–9: it makes their findings)', async ({}, info) => {
  test.fixme(!MANUAL_LINES_ON_TREE, WAITS.manualLines);
  const page = await as('owner');
  // Production: the invoice the receiver photographed in 5b (no OCR key → ocr_disabled). The lab's
  // scan storage is a placeholder, so the lab writes that same row (lab.ts failed-invoice).
  const invoiceId = LAB
    ? /INVOICE_ID=(\S+)/.exec(labTool('failed-invoice', facts.restaurantId, SUPPLIER_PRODUCE))?.[1]
    : state().invoiceId;
  expect(invoiceId, LAB ? 'lab failed-invoice id' : "5b's uploaded invoice (state file)").toBeTruthy();
  remember({ invoiceId });
  await visit(page, 'owner', `/dashboard/invoices/${invoiceId}`);
  await expect(page.getByTestId('invoice-ocr-failed')).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId('add-invoice-line-row');
  for (const l of MANUAL_LINES) {
    await row.getByLabel('תיאור', { exact: true }).fill(l.desc);
    await row.getByLabel('כמות', { exact: true }).fill(l.qty);
    await row.getByLabel('יחידה', { exact: true }).fill(l.unit);
    await row.getByLabel('מחיר יח׳', { exact: true }).fill(l.price);
    await page.getByTestId('add-invoice-line').click();
    await expect(row.getByLabel('תיאור', { exact: true })).toHaveValue('', { timeout: 30_000 }); // cleared on success
  }
  await page.reload();
  const text = await mainText(page);
  expect(text).toMatch(/1,320\.00\s?₪/);
  expect(text).toMatch(/38\.70\s?₪/);
  await expectMoneyRightAligned(page, 'invoice');
  await shot(page, info, '11-invoice-manual-lines');
  // The oil was ordered at 1,250: the owner's truth is a 70 ₪ price gap on it, not an unordered item.
  const queue = await visit(page, 'owner', '/dashboard/approvals');
  expect
    .soft(queue, 'hand-entered oil line should match the ordered product (70.00 ₪ price gap), not "item not ordered"')
    .toMatch(/70\.00\s?₪/);
  expectCleanConsole('owner', 'invoice manual lines');
});

/** Hand-entered lines: an overcharge on the oil (1,320 vs 1,250 ordered) and 3 kg of tomatoes billed. */
const MANUAL_LINES = [
  { desc: 'שמן זית 18 ליטר', qty: '1', unit: 'יח׳', price: '1320' },
  { desc: 'עגבניה שרי', qty: '3', unit: 'ק״ג', price: '12.90' },
] as const;

/** The role the approvals queue routes these findings to: the manager, unless the queue says owner. */
async function decider(): Promise<{ role: Role; page: Page }> {
  const manager = await as('manager');
  await visit(manager, 'manager', '/dashboard/approvals');
  if ((await manager.getByTestId('decide-approve').count()) > 0) return { role: 'manager', page: manager };
  test.info().annotations.push({
    type: 'routing',
    description: 'the manager’s queue routes these findings to the owner ("ממתינים לבעלים") — the owner decides',
  });
  const owner = await as('owner');
  await visit(owner, 'owner', '/dashboard/approvals');
  return { role: 'owner', page: owner };
}

test('8 · manager approves one finding, rejects one with a note, undoes within 10 s', async ({}, info) => {
  test.fixme(!MANUAL_LINES_ON_TREE, WAITS.manualLines);
  expect(state().invoiceId, "step 11's invoice (state file)").toBeTruthy();
  const { role, page } = await decider();
  const cards = page.getByTestId('approval-card');
  const before = await cards.count();
  expect(before, 'findings waiting in the queue').toBeGreaterThanOrEqual(2);
  await shot(page, info, `8-approvals-${role}`);
  await expectMoneyRightAligned(page, 'approvals');

  // Approve the first (→ claim): remember what step 9's letter must carry.
  const first = cards.first();
  const what = ((await first.innerText()).split('\n').find((l) => l.includes(SUPPLIER_PRODUCE)) ?? '').trim();
  const amount = ((await first.getByTestId('card-amount').innerText()) || '').replace(/[‎‏]/g, '').trim();
  await first.getByTestId('decide-approve').click();
  await expect(page.getByTestId('approvals-undo')).toBeVisible();
  remember({ claimed: { amount, what } });
  // Let its 10 s undo window lapse, so the approval sticks.
  await expect(page.getByTestId('approvals-undo')).toBeHidden({ timeout: 20_000 });
  await expect(cards).toHaveCount(before - 1);

  // Reject the next ("pay as billed") with a written note — then undo it inside the 10 s.
  const next = cards.first();
  await next.getByTestId('decide-reject').click();
  const reasons = page.getByTestId('waive-reasons');
  await reasons.getByRole('button', { name: 'אחר' }).click();
  await reasons.locator('textarea').fill('בדיקת פיילוט — הספק אישר בטלפון');
  await reasons.getByRole('button', { name: 'שלם כפי שחויב' }).click();
  await expect(page.getByTestId('approvals-undo')).toBeVisible();
  await expect(cards).toHaveCount(before - 2);
  await page.getByTestId('approvals-undo-button').click();
  await expect(page.getByText('ההחלטה בוטלה · הפער חזר לתור').first()).toBeVisible();
  await expect(cards).toHaveCount(before - 1);
  await shot(page, info, '8-after-undo');
  expectCleanConsole(role, 'approvals');
});

test('9 · the claims letter renders with the supplier and ₪', async ({}, info) => {
  test.fixme(!MANUAL_LINES_ON_TREE, WAITS.manualLines);
  const { claimed } = state();
  expect(claimed, "step 8's approved finding (state file)").toBeTruthy();
  const page = await as('owner');
  const text = await visit(page, 'owner', '/dashboard/leaks/claims');
  await shot(page, info, '9-claims');
  expect(text).toContain(TERMINOLOGY.creditClaim);
  expect(text, 'the letter names the supplier').toContain(SUPPLIER_PRODUCE);
  expect(text, `the letter carries the approved ${claimed!.amount}`).toContain(claimed!.amount);
  await expectMoneyRightAligned(page, 'claims letter');
  expectCleanConsole('owner', 'claims');
});

test('10 · bookkeeper downloads the CSV export', async ({}, info) => {
  const page = await as('bookkeeper');
  const text = await visit(page, 'bookkeeper', '/dashboard/exports');
  await shot(page, info, '10-exports');
  const [download] = await Promise.all([page.waitForEvent('download'), main(page).getByRole('button', { name: 'הורדת CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const path = await download.path();
  expect(path, 'the CSV downloaded').toBeTruthy();
  expect(text, `exports: old consolidated wording (decided term: ${TERMINOLOGY.consolidated})`).not.toMatch(OLD_CONSOLIDATED_TERM);
  expectCleanConsole('bookkeeper', 'exports');
});


test('12 · isolation: one branch, no demo names, a demo PO id is not found', async ({}, info) => {
  const page = await as('owner');
  const branches = await visit(page, 'owner', '/dashboard/branches');
  expect(branches).toContain(QA_TENANT_NAME);
  expect(branches).toContain('1 מתוך 1 סניפים');
  await expectSingleBranch(page, 'owner');
  // Terminology on the screens that carry it.
  expect(await visit(page, 'owner', '/dashboard/approvals')).toContain(TERMINOLOGY.discrepancy);
  expect(await visit(page, 'owner', '/dashboard/leaks/claims')).toContain(TERMINOLOGY.creditClaim);
  await expect(page.getByRole('navigation').first()).toContainText(TERMINOLOGY.receiving);
  const visited = state().visited ?? [];
  expect(visited.length, 'screens swept for demo names').toBeGreaterThan(5);
  for (const v of visited) {
    for (const name of facts.demoSupplierNames) expect(v.text, `${v.role} ${v.path} shows demo supplier "${name}"`).not.toContain(name);
  }
  if (facts.demoPoId) {
    for (const path of [`/dashboard/orders/${facts.demoPoId}`, `/dashboard/receiving/${facts.demoPoId}`]) {
      const res = await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      const text = (await page.locator('body').innerText()).replace(/[\u200e\u200f]/g, '');
      const list = errors.get('owner') ?? [];
      for (let i = list.length - 1; i >= 0; i--) if (/status of 40[34]/.test(list[i]!)) list.splice(i, 1);
      expect(
        (res?.status() ?? 0) === 404 || (res?.status() ?? 0) === 403 || /404|לא מצאנו|אין גישה|403/.test(text),
        `${path}: a demo PO must be not-found or forbidden for the QA owner`,
      ).toBe(true);
    }
  }
  await shot(page, info, '12-isolation');
  expectCleanConsole('owner', 'isolation');
});

test('13 · /accessibility and /privacy return 200, cookie banner on a fresh visit', async ({ browser }, info) => {
  const ctx = await newContext(browser, DESKTOP);
  const page = await ctx.newPage();
  for (const path of ['/accessibility', '/privacy']) {
    const res = await page.goto(path);
    expect(res?.status(), `${path}`).toBe(200);
  }
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'רק חיוניות' })).toBeVisible();
  await shot(page, info, '13-cookie-banner');
  expect(await answerCookieBanner(page)).toBe(true);
  await ctx.close();
});
