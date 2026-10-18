import { createCipheriv, randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import postgres from 'postgres';
import { hashPassword } from '@restomatch/crypto';
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
 * optionally, an enrolled TOTP secret). Resets lockout counters every call.
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
  // KNOWN, routed to S6: no app/icon.* / public/favicon.ico yet, so the
  // browser's implicit /favicon.ico request 404s on every page.
  /status of 404 \(Not Found\) \(http:\/\/[^)]+\/favicon\.ico\)/,
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
