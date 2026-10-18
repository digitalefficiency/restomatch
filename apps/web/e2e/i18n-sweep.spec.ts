import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { en as commonEn } from '../lib/i18n/messages/common/en';

/**
 * ENGLISH-MODE SWEEP (client-ready regression test).
 *
 * For every demo role, with `rm_locale=en`, crawl the app from /dashboard
 * (links followed MAX_DEPTH levels, a few samples per route pattern) at a
 * desktop and a phone width, and flag:
 *   - Hebrew characters in visible text / placeholders, EXCEPT inside an element
 *     marked `lang="he"` (intended originals: supplier/product names, scans);
 *   - `<html dir>` other than "ltr";
 *   - horizontal page overflow;
 *   - console errors / uncaught page errors;
 *   - the app error boundary or the 404 page.
 *
 * Needs the SEEDED demo tenant (./scripts/dev-setup.sh), so it is opt-in:
 *   I18N_SWEEP_BASE_URL=http://localhost:3000 \
 *     pnpm exec playwright test e2e/i18n-sweep.spec.ts
 * Paths owned by the receiving rewrite (S2) are reported but only fail the run
 * with I18N_SWEEP_STRICT=1. A JSON report lands in test-results/i18n-sweep.json.
 */
const BASE = process.env.I18N_SWEEP_BASE_URL;
const PASSWORD = process.env.I18N_SWEEP_PASSWORD ?? 'RestoMatch-Demo-2026!';
const STRICT = process.env.I18N_SWEEP_STRICT === '1';
const ROLES = (process.env.I18N_SWEEP_ROLES ?? 'owner,manager,receiver,bookkeeper,chef').split(',');
const MAX_DEPTH = 2;
const SAMPLES_PER_PATTERN = 2;
const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Areas being rewritten in another session — listed, not failed (unless STRICT). */
const DEFERRED = [/^\/dashboard\/receiving/, /^\/dashboard\/invoices/, /^\/scans/, /^\/showcase\/receiver/];
/** Never crawl: side effects, downloads, auth plumbing. */
const SKIP = [/^\/api\//, /logout|signout|sign-out/i, /\/download/, /\.(csv|txt|pdf|xlsx|zip)$/i];
/** Console noise that is not an app defect (CSP Report-Only notice, dev HMR). */
const CONSOLE_IGNORE = [/upgrade-insecure-requests/, /\[HMR\]|\[Fast Refresh\]/, /Download the React DevTools/];

const HEBREW = /[֐-׿]/;
const ERROR_TEXTS = [commonEn.errorPage.title, commonEn.notFound.title];

interface Finding {
  role: string;
  viewport: string;
  path: string;
  kind: 'hebrew' | 'dir' | 'overflow' | 'console' | 'error-page' | 'nav';
  detail: string;
  deferred: boolean;
}

/** `/dashboard/suppliers/8f0c…?tab=x` → `/dashboard/suppliers/:id?tab` (sampling key). */
function patternOf(path: string): string {
  const [p, q] = path.split('?');
  const norm = (p ?? '')
    .split('/')
    .map((seg) => (/^[0-9a-f-]{8,}$/i.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
  const keys = q ? [...new URLSearchParams(q).keys()].sort().join('&') : '';
  return keys ? `${norm}?${keys}` : norm;
}

async function login(browser: Browser, role: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE });
  await ctx.addCookies([
    { name: 'rm_locale', value: 'en', url: BASE! },
    { name: 'rm_cookie_consent', value: 'necessary', url: BASE! },
  ]);
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('form:has(#password) [name=email]').fill(`${role}@kfar-hazeitim.test`);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form:has(#password) button[type=submit]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  return page;
}

/** Visible Hebrew outside lang="he" islands (text nodes + placeholders/aria-labels). */
async function hebrewLeaks(page: Page): Promise<string[]> {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const out: string[] = [];
    const visible = (el: Element) =>
      (el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      const el = n.parentElement;
      if (!el || !re.test(text)) continue;
      if (el.closest('[lang="he"], script, style, noscript, template, [aria-hidden="true"]')) continue;
      if (!visible(el)) continue;
      out.push(`text: ${text.trim().slice(0, 80)}`);
    }
    for (const el of document.querySelectorAll('[placeholder], [aria-label], [title]')) {
      if (el.closest('[lang="he"]')) continue;
      for (const attr of ['placeholder', 'aria-label', 'title']) {
        const v = el.getAttribute(attr);
        if (v && re.test(v)) out.push(`${attr}: ${v.slice(0, 80)}`);
      }
    }
    return [...new Set(out)];
  }, HEBREW.source);
}

async function sameOriginLinks(page: Page): Promise<string[]> {
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
  const origin = new URL(BASE!).origin;
  return [
    ...new Set(
      hrefs
        .filter((h) => h.startsWith(origin))
        .map((h) => {
          const u = new URL(h);
          return u.pathname + u.search;
        })
        .filter((p) => /^\/(dashboard|admin|scans)/.test(p) && !SKIP.some((re) => re.test(p))),
    ),
  ];
}

// Containers with a preinstalled Chromium that doesn't match the Playwright
// build can point at it: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium.
if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

test.describe('English-mode sweep', () => {
  test.skip(!BASE, 'set I18N_SWEEP_BASE_URL (seeded demo tenant) to run');
  test.setTimeout(30 * 60_000);

  test('every reachable page renders clean English, LTR, without overflow or errors', async ({ browser }) => {
    const findings: Finding[] = [];
    const visitedByRole: Record<string, string[]> = {};

    for (const role of ROLES) {
      const page = await login(browser, role);
      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !CONSOLE_IGNORE.some((re) => re.test(m.text()))) consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

      // BFS over links, sampling a few concrete pages per route pattern.
      const seen = new Set<string>();
      const perPattern = new Map<string, number>();
      let frontier = ['/dashboard'];
      const toVisit: string[] = [];
      for (let depth = 0; depth <= MAX_DEPTH && frontier.length; depth += 1) {
        const next: string[] = [];
        for (const path of frontier) {
          if (seen.has(path)) continue;
          const pat = patternOf(path);
          if ((perPattern.get(pat) ?? 0) >= SAMPLES_PER_PATTERN) continue;
          seen.add(path);
          perPattern.set(pat, (perPattern.get(pat) ?? 0) + 1);
          toVisit.push(path);
          if (depth < MAX_DEPTH) {
            await page.setViewportSize(VIEWPORTS[0]);
            const res = await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => null);
            if (res) {
              await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
              next.push(...(await sameOriginLinks(page)));
            }
          }
        }
        frontier = next;
      }
      visitedByRole[role] = toVisit;

      for (const path of toVisit) {
        const deferred = DEFERRED.some((re) => re.test(path));
        for (const vp of VIEWPORTS) {
          await page.setViewportSize(vp);
          consoleErrors.length = 0;
          const add = (kind: Finding['kind'], detail: string) =>
            findings.push({ role, viewport: vp.name, path, kind, detail, deferred });
          const res = await page.goto(path, { waitUntil: 'domcontentloaded' }).catch((e: Error) => {
            add('nav', e.message.slice(0, 160));
            return null;
          });
          if (!res) continue;
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
          await page.waitForTimeout(250);

          const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
          if (dir !== 'ltr') add('dir', `html dir="${dir}"`);

          const overflow = await page.evaluate(() => {
            const d = document.documentElement;
            return d.scrollWidth - d.clientWidth;
          });
          if (overflow > 1) add('overflow', `${overflow}px wider than the viewport`);

          const heading = (await page.locator('h1, h2').allTextContents()).join(' | ');
          for (const t of ERROR_TEXTS) if (heading.includes(t)) add('error-page', t);

          // Hebrew is checked once per path (desktop) — it doesn't depend on width.
          if (vp.name === 'desktop') for (const leak of await hebrewLeaks(page)) add('hebrew', leak);

          for (const c of consoleErrors) add('console', c.slice(0, 200));
        }
      }
      await page.context().close();
    }

    const blocking = findings.filter((f) => STRICT || !f.deferred);
    const summary = {
      visited: Object.fromEntries(Object.entries(visitedByRole).map(([r, p]) => [r, p.length])),
      totals: {
        all: findings.length,
        blocking: blocking.length,
        byKind: findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }), {}),
      },
      findings,
      visitedByRole,
    };
    await mkdir('test-results', { recursive: true });
    await writeFile(join('test-results', 'i18n-sweep.json'), JSON.stringify(summary, null, 2));
    console.log(`i18n sweep: ${findings.length} findings (${blocking.length} blocking)`, summary.totals.byKind);

    expect(blocking, JSON.stringify(blocking.slice(0, 40), null, 2)).toEqual([]);
  });
});
