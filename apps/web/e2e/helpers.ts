import { createCipheriv, randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { hashPassword } from '@restomatch/crypto';
import {
  drillMismatch,
  shekelPlacement,
  totalMismatch,
  zeroViolation,
  type GlyphBoxes,
  type MoneyState,
  type TotalCheck,
} from './invariants/logic';
import { DEMO_RESTAURANT_NAME, E2E_AUTH_ENC_KEY, E2E_DATABASE_URL, MAGIC_LINK_FILE } from './env';

/** Owner connection to the e2e DB (fixtures only — the app itself runs on the RLS role). */
export function e2eSql() {
  return postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
}

/** Hebrew letters (incl. final forms) + gershayim — "leftover Hebrew" detector. */
export const HEBREW = /[֐-׿]/;

async function waitForMagicLink(email: string, since: number): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const parsed = JSON.parse(await readFile(MAGIC_LINK_FILE, 'utf8')) as {
        identifier: string;
        url: string;
        at: number;
      };
      if (parsed.identifier === email && parsed.at >= since) return parsed.url;
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`magic link for ${email} did not appear in ${MAGIC_LINK_FILE} within 30s`);
}

/**
 * Sign in through Auth.js's own endpoints (csrf → nodemailer sign-in → the link
 * the dev hook writes to MAGIC_LINK_FILE). Independent of the /login page markup,
 * so a login-page redesign can't break every other spec.
 */
export async function loginViaMagicLink(page: Page, email: string, callbackUrl = '/dashboard') {
  await unlink(MAGIC_LINK_FILE).catch(() => {});
  const since = Date.now();
  const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
  const res = await page.request.post('/api/auth/signin/nodemailer', {
    form: { email, csrfToken: csrf.csrfToken, callbackUrl },
    maxRedirects: 0,
  });
  expect(res.status(), 'nodemailer sign-in should redirect to verify-request').toBeLessThan(400);
  await page.goto(await waitForMagicLink(email, since));
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

/** AES-256-GCM in the exact `v1:<iv>:<tag>:<ct>` format of lib/totp.ts encryptSecret(). */
function encryptTotpSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(E2E_AUTH_ENC_KEY, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${enc.toString('base64url')}`;
}

/**
 * Idempotently create a manager of the demo restaurant with a password (and,
 * optionally, an enrolled TOTP secret). Resets lockout counters every call,
 * and the login throttle with them (see below).
 */
export async function ensurePasswordUser(opts: {
  email: string;
  password: string;
  totpSecret?: string;
}): Promise<void> {
  const sql = e2eSql();
  try {
    const [restaurant] = await sql<{ id: string }[]>`
      select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!restaurant) throw new Error('demo restaurant missing — e2e/prepare-db.ts did not seed');
    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, email_verified) values (${opts.email}, 'E2E', now())
      on conflict (email) do update set email = excluded.email
      returning id`;
    await sql`
      insert into memberships (user_id, restaurant_id, role)
      values (${user!.id}, ${restaurant.id}, 'manager') on conflict do nothing`;
    const hash = await hashPassword(opts.password);
    const totp = opts.totpSecret ? encryptTotpSecret(opts.totpSecret) : null;
    await sql`
      insert into user_credentials (user_id, password_hash, password_updated_at, totp_secret_enc, totp_enabled_at)
      values (${user!.id}, ${hash}, now(), ${totp}, ${totp ? sql`now()` : null})
      on conflict (user_id) do update set
        password_hash = excluded.password_hash,
        password_updated_at = now(),
        totp_secret_enc = excluded.totp_secret_enc,
        totp_enabled_at = excluded.totp_enabled_at,
        totp_last_step = null,
        failed_login_count = 0,
        locked_until = null`;
    // The login throttle (lib/rateLimit.ts: 10/email + 30/IP per fixed 15-min window,
    // stored in rate_limit_counters) counts SUCCESSFUL logins against the IP too. Every
    // e2e sign-in comes from 127.0.0.1, so the whole serial run shares one 30-attempt
    // budget: W1-01..W1-08 spend ~25 of it, and W1-09 auth-11's second correct login
    // became attempt #31 → a uniform CredentialsSignin. Start every password user from
    // a clean throttle, like the lockout columns above (and e2e/run-demo-path.sh).
    await sql`delete from rate_limit_counters where key like 'login:%'`;
  } finally {
    await sql.end();
  }
}

/**
 * Collect everything that would show up red in DevTools: console.error and
 * uncaught page errors. Known dev-only noise is filtered (see IGNORED).
 */
const IGNORED: RegExp[] = [
  // React DevTools nag (dev builds only).
  /Download the React DevTools/,
  // Next dev HMR socket churn when a route recompiles mid-navigation.
  /webpack-hmr|_next\/webpack-hmr|turbopack-hmr/,
];

export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED.some((re) => re.test(text))) return;
    const where = msg.location()?.url;
    errors.push(`console.error: ${text}${where && /Failed to load resource/.test(text) ? ` (${where})` : ''}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

// ─── G-16 cross-surface invariants (slice b) ─────────────────────────────────
// Each helper returns its violations. Warn mode (default) logs them with the page;
// G16_MODE=error (W4-01) turns them into a failed expect. The rules live in
// ./invariants/logic.ts (unit-tested); these only read the page.

const G16_ERROR = process.env.G16_MODE === 'error';

function g16Report(page: Page, rule: string, violations: string[]): string[] {
  if (violations.length) console.warn(`[G-16] ${rule} · ${new URL(page.url()).pathname}: ${violations.length}\n  ${violations.join('\n  ')}`);
  if (G16_ERROR) expect(violations, `G-16 ${rule} on ${page.url()}`).toEqual([]);
  return violations;
}

/** Every [data-money-sum-of] total equals its [data-money-row-of] rows to the agora (cap honoured). */
export async function expectTotalsMatchRows(page: Page): Promise<string[]> {
  const checks = await page.evaluate(() => {
    const int = (v: string | null) => (v == null || v === '' ? NaN : Number(v));
    return [...document.querySelectorAll<HTMLElement>('[data-money-sum-of]')].map((el) => {
      const group = el.dataset.moneySumOf ?? '';
      const rows = [...document.querySelectorAll<HTMLElement>(`[data-money-row-of="${CSS.escape(group)}"]`)];
      const cap = el.dataset.moneyCapAgorot;
      return {
        group,
        totalAgorot: int(el.dataset.moneyAgorot ?? null),
        rowAgorot: rows.map((r) => int(r.dataset.moneyAgorot ?? null)),
        capAgorot: cap != null ? Number(cap) : null,
      };
    });
  });
  return g16Report(page, 'totals-match-rows', checks.map((c: TotalCheck) => totalMismatch(c)).filter((v): v is string => v != null));
}

/** Follows every [data-drill] on the page and checks the list's [data-drill-total] to the agora. */
export async function expectDrillParity(page: Page): Promise<string[]> {
  const links = await page.$$eval('a[data-drill][data-money-agorot]', (as) =>
    (as as HTMLAnchorElement[]).map((a) => ({ href: a.getAttribute('href') ?? '', agorot: Number(a.dataset.moneyAgorot) })),
  );
  const from = page.url();
  const out: string[] = [];
  for (const link of links) {
    if (!link.href) continue;
    await page.goto(link.href);
    const total = await page
      .locator('[data-drill-total]')
      .first()
      .getAttribute('data-drill-total', { timeout: 5000 })
      .catch(() => null);
    const v = drillMismatch(link, total == null ? null : Number(total));
    if (v) out.push(v);
  }
  if (links.length) await page.goto(from);
  return g16Report(page, 'drill-parity', out);
}

/** In he, the ₪ glyph renders left of the first digit in every element holding a ₪ amount. */
export async function expectShekelLeftOfDigits(page: Page): Promise<string[]> {
  const boxes = await page.evaluate(() => {
    const out: GlyphBoxes[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const box = (node: Text, i: number) => {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const b = r.getBoundingClientRect();
      return b.width > 0 ? { left: b.left, right: b.right } : null;
    };
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const t = n.data;
      const s = t.indexOf('₪');
      const d = t.search(/\d/);
      if (s < 0 || d < 0) continue;
      out.push({ text: t, shekel: box(n, s), firstDigit: box(n, d) });
    }
    return out;
  });
  return g16Report(page, 'shekel-left-of-digits', boxes.map(shekelPlacement).filter((v): v is string => v != null));
}

/** No red ₪0, and no ₪0 where [data-money-state] says unmeasured / unavailable. */
export async function expectNoZeroForUnknown(page: Page): Promise<string[]> {
  const items = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-money-agorot], [data-money-state]')].map((el) => ({
      text: el.innerText ?? '',
      state: (el.dataset.moneyState ?? null) as MoneyState | null,
      color: getComputedStyle(el).color,
    })),
  );
  return g16Report(page, 'no-zero-for-unknown', items.map(zeroViolation).filter((v): v is string => v != null));
}
