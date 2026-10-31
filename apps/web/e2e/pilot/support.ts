/**
 * Shared helpers for the pilot journey and probe (docs/PILOT-QA.md).
 *
 * Owner decisions live here as single constants, so a decision change is a one-line edit:
 * CHEF_CAN_CREATE_ORDERS, the forbidden target copy, the terminology list.
 */
import { readFileSync } from 'node:fs';
import { expect, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';

/* ── owner decisions (assertions read these) ───────────────────────────────── */

/**
 * Can the chef create an order? Owner decision (31.10, final): YES — freely, no manager approval.
 * The chef sees prices and totals on the ORDERS screens only; everywhere else the chef sees no ₪.
 */
export const CHEF_CAN_CREATE_ORDERS = true;

/** No target anywhere: the 1.5% pilot target and the word "יעד" must not reach a screen. */
export const FORBIDDEN_TARGET_COPY: readonly RegExp[] = [/1\.5\s*%/, /יעד/];

/** Owner terminology, each expected on the screen named next to it. */
export const TERMINOLOGY = {
  consolidated: 'מרכזת',
  discrepancy: 'פער',
  creditClaim: 'דרישת זיכוי',
  receiving: 'קבלת סחורה',
} as const;

export const QA_TENANT_NAME = 'RestoMatch QA (פנימי)';

/* ── facts (lab) and credentials ───────────────────────────────────────────── */

export type Role = 'owner' | 'manager' | 'receiver' | 'chef' | 'bookkeeper';
export interface Facts {
  restaurantId: string;
  restaurantName: string;
  demoPoId: string | null;
  demoSupplierNames: string[];
  members: { email: string; role: Role; locale: string }[];
}

export type ProbeMode = '' | 'public' | 'readonly' | 'write';
export const PROBE = (process.env.PILOT_PROBE ?? '') as ProbeMode;
/** Stage A: a local lab DB is reachable (lab-only helpers and fresh-tenant assertions). */
export const LAB = Boolean(process.env.PILOT_LAB_DATABASE_URL);

/**
 * Lab facts (scripts/pilot-lab.sh → e2e/pilot/lab.ts facts). Stage C (PILOT_PROBE=write) has no
 * lab: the QA restaurant id is PILOT_TENANT_CONFIRM, and the demo ids/names are optional env.
 */
export function loadFacts(): Facts {
  if (PROBE === 'write') {
    return {
      restaurantId: process.env.PILOT_TENANT_CONFIRM ?? '',
      restaurantName: QA_TENANT_NAME,
      demoPoId: process.env.PILOT_DEMO_PO_ID || null,
      demoSupplierNames: (process.env.PILOT_DEMO_SUPPLIERS ?? '').split('|').filter(Boolean),
      members: [],
    };
  }
  const path = process.env.PILOT_FACTS;
  if (!path) throw new Error('PILOT_FACTS is not set — run the journey through scripts/pilot-lab.sh');
  return JSON.parse(readFileSync(path, 'utf8')) as Facts;
}

/**
 * Who signs in as a role. Lab: the QA config's member + PILOT_LAB_PASSWORD.
 * Production (Stage B/C, Rom's machine only): PILOT_<ROLE>_EMAIL + PILOT_<ROLE>_PASSWORD.
 */
export function credentials(role: Role, facts?: Facts): { email: string; password: string } {
  const up = role.toUpperCase();
  const email = process.env[`PILOT_${up}_EMAIL`] ?? facts?.members.find((m) => m.role === role)?.email;
  const password = process.env[`PILOT_${up}_PASSWORD`] ?? process.env.PILOT_LAB_PASSWORD;
  if (!email || !password) throw new Error(`no credentials for ${role}: set PILOT_${up}_EMAIL / PILOT_${up}_PASSWORD`);
  return { email, password };
}

/* ── browser contexts ──────────────────────────────────────────────────────── */

export const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
/** Pixel 7 (Playwright's device descriptor, inlined so the config stays engine-agnostic). */
export const PIXEL_7 = {
  viewport: { width: 412, height: 839 },
  screen: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Mobile Safari/537.36',
};

export async function newContext(browser: Browser, device: typeof DESKTOP | typeof PIXEL_7): Promise<BrowserContext> {
  return browser.newContext({ ...device, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', acceptDownloads: true });
}

/* ── page helpers ──────────────────────────────────────────────────────────── */

/** Errors the page raised (uncaught exceptions + console errors), cleared per screen. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** The cookie bar: a fresh browser shows it; answer "essential only" like a real first visit. */
export async function answerCookieBanner(page: Page): Promise<boolean> {
  const essential = page.getByRole('button', { name: 'רק חיוניות' });
  if (await essential.isVisible().catch(() => false)) {
    await essential.click();
    return true;
  }
  return false;
}

export async function signIn(page: Page, role: Role, facts?: Facts): Promise<void> {
  const { email, password } = credentials(role, facts);
  await page.goto('/login');
  await answerCookieBanner(page);
  const form = page.locator('form', { has: page.locator('input[type="password"]') }).first();
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[type="password"]').fill(password);
  await form.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
}

/**
 * The signed-in page belongs to the QA tenant — or the run stops here. Reads the session
 * (GET /api/auth/session) and the shell's restaurant name; never clicks anything.
 * `expectedId` (PILOT_TENANT_CONFIRM) is required for Stage C.
 */
export async function assertQaTenant(page: Page, expectedId?: string): Promise<string> {
  const res = await page.request.get('/api/auth/session');
  const session = (await res.json().catch(() => null)) as { user?: { restaurantId?: string | null } } | null;
  const id = session?.user?.restaurantId ?? '';
  const shell = ((await page.locator('header').first().textContent()) ?? '').replace(/[\u200e\u200f]/g, '');
  if (!shell.includes(QA_TENANT_NAME)) {
    throw new Error(`[pilot] STOP: the signed-in tenant is not "${QA_TENANT_NAME}" — refusing to continue`);
  }
  if (expectedId !== undefined && (!expectedId || id !== expectedId)) {
    throw new Error('[pilot] STOP: the active restaurant id does not equal PILOT_TENANT_CONFIRM — refusing to continue');
  }
  return id;
}

/**
 * "The branch switcher has exactly 1 entry". The shell renders the switcher only for a user with
 * more than one membership, so one branch = no switcher (or, if it ever renders, one option).
 */
export async function expectSingleBranch(page: Page, where: string): Promise<void> {
  const switcher = page.getByTestId('branch-switcher');
  if (await switcher.isVisible().catch(() => false)) {
    await switcher.click();
    await expect(page.getByTestId('branch-option'), `${where}: branch switcher entries`).toHaveCount(1);
    await page.keyboard.press('Escape');
  } else {
    await expect(page.getByTestId('branch-option'), `${where}: branch switcher entries`).toHaveCount(0);
  }
}

export function main(page: Page): Locator {
  return page.locator('main').last();
}

/** Visible text of <main>, bidi marks removed. */
export async function mainText(page: Page): Promise<string> {
  return (await main(page).innerText()).replace(/[‎‏⁦-⁩]/g, '');
}

export async function expectNoShekel(page: Page, where: string): Promise<void> {
  const text = await mainText(page);
  expect(text.includes('₪'), `${where}: "₪" visible to a role that must not see money\n${text.slice(0, 600)}`).toBe(false);
}

export async function expectNoTarget(page: Page, where: string): Promise<void> {
  const text = await mainText(page);
  for (const re of FORBIDDEN_TARGET_COPY) expect(text, `${where}: target copy ${re}`).not.toMatch(re);
}

/** Every element whose own text is a ₪ amount must not be left-aligned in RTL (numbers sit right). */
export async function expectMoneyRightAligned(page: Page, where: string): Promise<void> {
  const offenders = await main(page).evaluate((root) => {
    const bad: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('td, th, dd, span, p, div'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!/₪/.test(own) || el.offsetParent === null) continue;
      const align = getComputedStyle(el).textAlign;
      const dir = getComputedStyle(el).direction;
      // "left" in an RTL block = numbers hugging the wrong edge. start/right/center/end are fine.
      if (dir === 'rtl' && align === 'left') bad.push(own.slice(0, 40));
    }
    return bad;
  });
  expect(offenders, `${where}: ₪ amounts left-aligned in RTL`).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${where}: horizontal overflow (${overflow}px)`).toBeLessThanOrEqual(1);
}

/** Full-page screenshot attached to the HTML report under a step name. */
export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

/** A ₪ amount like "1,250 ₪" / "₪1,250.00" → 1250. */
export function shekels(text: string): number[] {
  return [...text.replace(/[‎‏]/g, '').matchAll(/(?:₪\s?)?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)(?:\s?₪)?/g)]
    .filter((m) => m[0].includes('₪'))
    .map((m) => Number(m[1]!.replace(/,/g, '')));
}
