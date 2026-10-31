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
  manualLines: "S2's manual invoice lines — without them a fresh tenant has no invoice lines, so no findings",
} as const;

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

/** Lab only: move an order's expected delivery into the past (the UI refuses past dates). */
function backdate(poId: string, days: number): void {
  const db = process.env.PILOT_LAB_DATABASE_URL;
  if (!db) throw new Error('PILOT_LAB_DATABASE_URL is not set (scripts/pilot-lab.sh sets it)');
  execFileSync('pnpm', ['--filter', '@restomatch/db', 'exec', 'tsx', resolve(HERE, 'lab.ts'), 'backdate', poId, String(days)], {
    cwd: resolve(HERE, '../../../..'),
    env: { ...process.env, DATABASE_URL: db },
    stdio: 'inherit',
  });
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

async function placeRecordOnlyOrder(page: Page, date: string): Promise<string> {
  await visit(page, 'owner', '/dashboard/orders/new');
  await main(page).getByRole('button', { name: SUPPLIER_PRODUCE }).click();
  await main(page).getByRole('button', { name: /^עגבניה שרי/ }).click();
  await main(page).getByRole('button', { name: /^שמן זית 18 ליטר/ }).click();
  await main(page).getByText('תאריך אחר', { exact: true }).click();
  await page.locator('#ord-delivery-date').fill(date);
  await main(page).getByRole('button', { name: 'המשך לסקירה' }).click();
  await page.locator('#ord-channel').selectOption('none');
  await page.getByRole('button', { name: /^סמנו כנשלחה/ }).click();
  // Send-with-undo: a 10 s countdown, then the confirmation.
  await expect(main(page)).toContainText('ההזמנה סומנה כנשלחה', { timeout: 30_000 });
  await expect(main(page)).toContainText('לא נשלח דבר לספק');
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
  await shot(page, info, '4-order-detail');
  const orderLateId = await placeRecordOnlyOrder(page, israelDate(0));
  remember({ orderLateId });
  if (LAB) backdate(orderLateId, 1);
  // The detail page is where "sent" copy would mislead the owner later (soft: setup above must finish).
  expect.soft(detail, 'order page: status copy says "sent" for a record-only order').not.toMatch(/נשלחה/);
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

test.fixme('5b · receiver uploads a 6 MB phone photo of the invoice', async () => {
  // Waits on: W1-06 image shrink. Then: build a 6 MB JPEG in the test, setInputFiles on the
  // photo step, expect "Check result"/the ocr_disabled notice (no ANTHROPIC_API_KEY) and the
  // receiver continuing against the order.
  void WAITS.uploadShrink;
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

test('7 · chef sees no ₪; /dashboard/orders/new matches CHEF_CAN_CREATE_ORDERS', async ({}, info) => {
  const page = await as('chef');
  await visit(page, 'chef', '/dashboard');
  await expectNoShekel(page, 'chef home');
  await expectNoTarget(page, 'chef home');
  await shot(page, info, '7-chef-home');
  const text = await visit(page, 'chef', '/dashboard/orders/new');
  await shot(page, info, '7-chef-orders-new');
  if (CHEF_CAN_CREATE_ORDERS) {
    expect(text, 'chef reaches the order wizard').toContain('הזמנה חדשה');
    expect(text).toContain(SUPPLIER_PRODUCE);
  } else {
    expect(text, 'chef is refused the order wizard').toMatch(/403|אין גישה|לא פתוח/);
  }
  expectCleanConsole('chef', 'chef');
});

test.fixme('8 · manager approves one finding, rejects one with a note, undoes within 10 s', async () => {
  // Waits on: S2's manual invoice lines (no OCR for a non-demo tenant ⇒ no findings yet).
  void WAITS.manualLines;
});

test.fixme('9 · the claims letter renders with the supplier and ₪', async () => {
  void WAITS.manualLines;
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

test.fixme('11 · an OCR-failed invoice gets a manual line', async () => {
  void WAITS.manualLines;
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
