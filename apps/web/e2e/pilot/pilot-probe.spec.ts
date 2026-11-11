/**
 * Pilot probe — Stage B of docs/PILOT-QA.md. GETs and logins only: it never clicks a button that
 * writes, never submits anything but the login form, and never reads a database.
 *
 *   PILOT_PROBE=public    unauthenticated: healthz (+ commit = EXPECTED_SHA), healthz?jobs=1,
 *                         /login, /accessibility, /privacy, cookie banner. Safe for anyone.
 *   PILOT_PROBE=readonly  public + one login per QA role from PILOT_<ROLE>_EMAIL / _PASSWORD
 *                         (Rom's machine only — OPERATING.md: no agent logs in to production).
 *
 * Every login first proves the session is the QA tenant ("RestoMatch QA (פנימי)", and
 * PILOT_TENANT_CONFIRM if set) — on any other tenant the run stops before reading a screen.
 */
import { expect, test } from '@playwright/test';
import {
  DESKTOP,
  PIXEL_7,
  PROBE,
  assertQaTenant,
  expectNoShekel,
  expectNoTarget,
  expectSingleBranch,
  mainText,
  newContext,
  shot,
  signIn,
  type Role,
} from './support';

// The shared apps/web/playwright.config.ts globs e2e/**: these run only via playwright.pilot.config.ts.
test.skip(!process.env.PILOT_SUITE, 'pilot suite: run with -c e2e/pilot/playwright.pilot.config.ts');
test.describe.configure({ mode: 'default' });

const BASE = process.env.PILOT_BASE_URL ?? 'http://localhost:3400';
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${BASE}/`);
const EXPECTED_SHA = process.env.EXPECTED_SHA ?? '';

/** Roles whose screens must show no money. */
const NO_MONEY: readonly Role[] = ['receiver', 'chef'];
const ROLES: readonly Role[] = ['owner', 'manager', 'receiver', 'chef', 'bookkeeper'];

test.beforeAll(() => {
  if (!LOCAL && !EXPECTED_SHA) throw new Error('[pilot] set EXPECTED_SHA (the promoted commit) to probe a remote deployment');
});

/* ── public: no login ────────────────────────────────────────────────────── */

test('healthz is ok and serves the expected commit', async ({ request }) => {
  const res = await request.get('/api/healthz');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status?: string; commit?: string | null };
  expect(body.status).toBe('ok');
  if (EXPECTED_SHA) expect(body.commit ?? '', 'healthz commit').toBe(EXPECTED_SHA);
});

test('healthz?jobs=1 is ok', async ({ request }, info) => {
  const res = await request.get('/api/healthz?jobs=1');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status?: string; jobs?: { ok?: boolean } & Record<string, unknown> };
  expect(body.status).toBe('ok');
  if (body.jobs === undefined) {
    // The jobs section is not on main + #167 yet: this check is a plain liveness check until it is.
    info.annotations.push({ type: 'note', description: 'healthz has no "jobs" section on this deployment' });
  } else {
    expect(body.jobs.ok, `healthz jobs: ${JSON.stringify(body.jobs)}`).not.toBe(false);
  }
});

test('/login, /accessibility and /privacy return 200; cookie banner on a fresh visit', async ({ browser }, info) => {
  const ctx = await newContext(browser, DESKTOP);
  const page = await ctx.newPage();
  for (const path of ['/accessibility', '/privacy', '/login']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
  await expect(page.getByRole('button', { name: 'רק חיוניות' })).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  await shot(page, info, 'login-cookie-banner');
  await ctx.close();
});

/* ── readonly: one login per QA role (Rom only) ──────────────────────────── */

for (const role of ROLES) {
  test(`readonly · ${role} signs in and lands on their home`, async ({ browser }, info) => {
    test.skip(PROBE !== 'readonly', 'PILOT_PROBE=readonly only');
    const up = role.toUpperCase();
    // The QA example config has owner, manager and receiver; chef/bookkeeper run when Rom sets them.
    test.skip(!process.env[`PILOT_${up}_EMAIL`], `PILOT_${up}_EMAIL is not set`);
    const ctx = await newContext(browser, role === 'receiver' ? PIXEL_7 : DESKTOP);
    const page = await ctx.newPage();
    try {
      await signIn(page, role);
      await assertQaTenant(page, process.env.PILOT_TENANT_CONFIRM || undefined);
      await expect(page).toHaveURL(/\/dashboard\/?(\?|$)/);
      await page.waitForLoadState('networkidle').catch(() => {});
      const text = await mainText(page);
      expect(text.trim().length, `${role} home rendered`).toBeGreaterThan(0);
      await expectNoTarget(page, `${role} home`);
      if (NO_MONEY.includes(role)) await expectNoShekel(page, `${role} home`);
      await expectSingleBranch(page, `${role} home`);
      await shot(page, info, `${role}-home`);
    } finally {
      await ctx.close();
    }
  });
}

test('readonly · at least the owner credentials are set', async () => {
  test.skip(PROBE !== 'readonly', 'PILOT_PROBE=readonly only');
  expect(process.env.PILOT_OWNER_EMAIL, 'PILOT_OWNER_EMAIL').toBeTruthy();
  expect(process.env.PILOT_OWNER_PASSWORD, 'PILOT_OWNER_PASSWORD').toBeTruthy();
});
