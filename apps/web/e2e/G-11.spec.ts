import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { LEGAL_LINKS } from '../lib/legal/registry';
import { e2eSql, loginViaMagicLink } from './helpers';
import { DEMO_RESTAURANT_NAME } from './env';

/**
 * G-11 · one set of legal links (auth-32, a11y-01, admin-03, mkt-02; WCAG 3.2.6).
 * Every shell shows the registry's links in the registry's order; the statement
 * answers 200 to anonymous visitors in he and en; robots allows it.
 *
 * G_11_SHOTS=1 also writes the DoD-1 screens to e2e/__screenshots__/G-11/.
 */
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.G_11_SHOTS ? 'e2e/__screenshots__/G-11' : null;
const ORDER = LEGAL_LINKS.map((l) => l.id);
type Locale = 'he' | 'en';

async function open(page: Page, path: string, locale: Locale = 'he') {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  const res = await page.goto(path, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  return res;
}

/**
 * The legal ids of the shell's legal list. A page may show the list twice (the
 * legal pages' related row + the marketing footer); every list must be whole and
 * in order, so read them per `[data-legal-links]` group.
 */
async function legalGroups(page: Page): Promise<string[][]> {
  return page.locator('[data-legal-links]').evaluateAll((uls) =>
    uls.map((ul) => [...ul.querySelectorAll('[data-legal-id]')].map((a) => a.getAttribute('data-legal-id') ?? '')),
  );
}

async function expectLegalOrder(page: Page) {
  const groups = await legalGroups(page);
  expect(groups.length, `no legal list on ${page.url()}`).toBeGreaterThan(0);
  for (const g of groups) expect(g, page.url()).toEqual(ORDER);
}

async function axeSerious(page: Page, include: string) {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (sel) => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe;
    const r = await axe.run({ include: [sel] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id);
  }, include);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** A fresh supplier link (the W1-09 pattern), optionally already expired. */
async function supplierToken(expired: boolean): Promise<string> {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    await sql`update restaurants set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{features,supplierConfirm}', 'true'::jsonb, true) where id = ${r!.id}`;
    const [po] = await sql<{ id: string }[]>`
      select po.id from purchase_orders po
      where po.restaurant_id = ${r!.id} and po.status in ('sent','confirmed','partial')
      order by po.created_at desc limit 1`;
    if (!po) throw new Error('no demo order');
    const token = randomBytes(32).toString('base64url');
    // expires_at > created_at is a CHECK: an expired link is backdated, not inverted.
    const created = expired ? '-73 hours' : '0 hours';
    const expires = expired ? '-1 hour' : '72 hours';
    await sql`
      insert into supplier_confirm_links (restaurant_id, po_id, token_hash, created_at, expires_at)
      values (${r!.id}, ${po.id}, ${createHash('sha256').update(token, 'utf8').digest('hex')},
              now() + ${created}::interval, now() + ${expires}::interval)`;
    return token;
  } finally {
    await sql.end();
  }
}

test.describe('G-11 legal links: same links, same order, every shell', () => {
  // Anonymous. Routes behind a session redirect to /login, whose AuthShell must
  // carry the same list; the final URL is whatever the route answers.
  const ANON = [
    '/',
    '/pricing',
    '/showcase',
    '/privacy',
    '/accessibility',
    '/login',
    '/login/check-email',
    '/reset',
    '/set-password',
    '/invite/accept',
    '/onboarding',
  ];
  for (const path of ANON) {
    test(`anonymous ${path}`, async ({ page }) => {
      await open(page, path);
      await expectLegalOrder(page);
    });
  }

  test('supplier portal /s/<valid|expired|unknown>', async ({ page }) => {
    for (const token of [await supplierToken(false), await supplierToken(true), 'g11-unknown-token']) {
      await open(page, `/s/${token}`);
      await expectLegalOrder(page);
    }
  });

  test('admin console (signed in as the platform admin)', async ({ page }) => {
    await loginViaMagicLink(page, 'owner@kfar-hazeitim.test', '/admin');
    await open(page, '/admin');
    await expect(page).toHaveURL(/\/admin$/);
    await expectLegalOrder(page);
    expect(await axeSerious(page, 'footer')).toEqual([]);
  });

  test('root 404, anonymous (marketing chrome)', async ({ page }) => {
    // A public prefix, so the middleware answers 404 instead of redirecting to /login.
    const res = await open(page, '/showcase/g11-no-such-page');
    expect(res?.status()).toBe(404);
    await expectLegalOrder(page);
  });

  // app/not-found.tsx's signed-in branch is a bare card outside G-11's boundary.
  test.fixme('root 404, signed in (awaiting a footer in app/not-found.tsx)', async () => {});

  test.fixme('dashboard + settings footer (awaiting W2-08 footer)', async () => {});
  test.fixme('/scans/<id> footer (awaiting W2-02)', async () => {});
});

test.describe('G-11 statement reachable (WCAG 3.2.6, reg. 35)', () => {
  for (const locale of ['he', 'en'] as const) {
    test(`${locale}: anonymous /accessibility answers 200, no redirect`, async ({ page }) => {
      const res = await open(page, '/accessibility', locale);
      expect(res?.status()).toBe(200);
      expect(res?.request().redirectedFrom()).toBeNull();
      await expect(page).toHaveURL(/\/accessibility$/);
    });
  }

  test('robots.txt allows /accessibility', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toMatch(/^Allow: \/accessibility$/m);
  });

  test('auth footer is axe-clean and every link is a ≥44px target on a phone', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await open(page, '/login');
    expect(await axeSerious(page, 'footer')).toEqual([]);
    for (const box of await page.locator('footer [data-legal-id]').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height)))
      expect(box).toBeGreaterThanOrEqual(44);
    await ctx.close();
  });
});

test.describe('G-11 DoD-1 screens', () => {
  test.skip(!SHOTS, 'set G_11_SHOTS=1 to write the screens');
  const SCREENS = [
    ['home', '/'],
    ['legal', '/privacy'],
    ['login', '/login'],
    ['showcase', '/showcase'],
  ] as const;
  for (const [name, path] of SCREENS) {
    for (const [locale, width, height] of [
      ['he', 390, 844],
      ['he', 1440, 900],
      ['en', 1440, 900],
    ] as const) {
      test(`${name} ${locale} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await open(page, path, locale);
        await page.locator('[data-legal-links]').last().scrollIntoViewIfNeeded();
        await shot(page, `${name}-${locale}-${width}`);
      });
    }
  }
});
