import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from '@playwright/test';
import { en } from '../lib/i18n/messages/nav/en';
import { he } from '../lib/i18n/messages/nav/he';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';
import { evaluateDensity, figureDrift, formatFinding, newFindings, VIEWPORTS, type DensityCounts, type Finding } from './ia/budget';
import { measureDensity } from './ia/meter';
import { DENSITY_SCREENS, type DensityScreen, type Role } from './ia/screens';

/**
 * IA-01 — density budgets as a check (IA-SPEC rule 4 + rule 7 "a figure once"), REPORT
 * MODE: every home / queue / record in ia/screens.ts is measured in the first fold and
 * compared with its screen type's budget. Findings are logged and written to
 * `test-results/ia-01/report.json` (also attached); nothing fails.
 *
 *   pnpm --filter @restomatch/web exec playwright test e2e/IA-01.spec.ts
 *   IA01_ENFORCE=1 …   # fail on findings beyond each screen's ratchet allowance (wave 4, H-09ʰ)
 *
 * One magic-link login per role (the login rate limit), then every screen of that role.
 */

const ENFORCE = process.env.IA01_ENFORCE === '1';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'ia-01');
const ROLES: Role[] = ['owner', 'manager', 'bookkeeper', 'chef', 'receiver'];

interface ScreenResult {
  id: string;
  route: string;
  role: Role;
  vp: string;
  type: string;
  adopter: string;
  status: number | null;
  counts?: DensityCounts;
  findings: Finding[];
  newFindings: Finding[];
  error?: string;
}

const results: ScreenResult[] = [];
let ids: Record<string, string> = {};

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from rate_limit_counters`.catch(() => {});
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) return;
    const [inv] = await sql<{ id: string }[]>`select id from invoices where restaurant_id = ${r.id} order by created_at desc limit 1`;
    const [po] = await sql<{ id: string }[]>`select id from purchase_orders where restaurant_id = ${r.id} order by created_at desc limit 1`;
    const [sup] = await sql<{ id: string }[]>`select id from suppliers where restaurant_id = ${r.id} order by name limit 1`;
    ids = { invoice: inv?.id ?? '', po: po?.id ?? '', supplier: sup?.id ?? '' };
  } finally {
    await sql.end();
  }
});

function resolve(route: string): string | null {
  const out = route.replace(/:(invoice|po|supplier)/g, (_, k: string) => ids[k] ?? '');
  return /\/$/.test(out) || out.includes('//') ? null : out;
}

/**
 * The lab runs no worker, so every dashboard page shows the warn-toned "מנוע העיבוד לא זמין"
 * status banner (dashboard/worker-status.tsx). Production runs jobs in Vercel cron and never
 * shows it; counting it would add a T2 mark, a block and ~20 words to every screen.
 */
const WORKER_BANNER_TITLES = [he.worker.title, en.worker.title];

async function stripLabOnlyBanners(page: Page): Promise<number> {
  return page.evaluate((titles) => {
    let n = 0;
    for (const el of document.querySelectorAll('main [role="status"]')) {
      const text = el.textContent ?? '';
      if (titles.some((t) => text.includes(t))) {
        el.remove();
        n++;
      }
    }
    return n;
  }, WORKER_BANNER_TITLES);
}

async function measureScreen(page: Page, s: DensityScreen): Promise<ScreenResult> {
  const base = { id: s.id, route: s.route, role: s.role, vp: s.vp, type: s.type, adopter: s.adopter };
  const url = resolve(s.route);
  if (!url) return { ...base, status: null, findings: [], newFindings: [], error: 'no seeded record for this route' };
  await page.setViewportSize(VIEWPORTS[s.vp]);
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle' });
    // Late client islands (deferred cards) settle after networkidle in next dev.
    await page.waitForTimeout(500);
    const labOnly = await stripLabOnlyBanners(page);
    const counts = await measureDensity(page);
    if (labOnly) console.log(`[IA-01] ${s.id}: removed ${labOnly} lab-only worker banner(s) before measuring`);
    const findings = evaluateDensity(s.type, s.vp, counts);
    return { ...base, status: res?.status() ?? null, counts, findings, newFindings: newFindings(findings, s.allow) };
  } catch (e) {
    return { ...base, status: null, findings: [], newFindings: [], error: String(e).slice(0, 300) };
  }
}

test.describe('IA-01 density budgets (report mode)', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'rm_cookie_consent', value: 'necessary', url: baseURL! }]);
  });

  for (const role of ROLES) {
    test(`${role}: homes, queues and records within the rule-4 budget`, async ({ page }, info) => {
      const screens = DENSITY_SCREENS.filter((s) => s.role === role);
      test.skip(screens.length === 0, 'no screens for this role');
      await loginViaMagicLink(page, `${role}@kfar-hazeitim.test`);
      for (const s of screens) {
        const r = await measureScreen(page, s);
        results.push(r);
        const head = `[IA-01] ${r.id} (${r.type}/${r.vp}) ${r.route} → ${r.status ?? 'ERR'}`;
        if (r.error) console.log(`${head} · ${r.error}`);
        else if (r.counts) {
          const c = r.counts;
          console.log(
            `${head} · words ${c.words}/${c.pageWords} · blocks ${c.blocks} · numbers ${c.numbers} · T2 ${c.t2} · primary ${c.primary} · rows ${c.rows.length}` +
              (r.findings.length ? `\n    ${r.findings.map(formatFinding).join('\n    ')}` : ' · within budget'),
          );
        }
      }
      await info.attach(`ia-01-${role}.json`, {
        body: JSON.stringify(results.filter((r) => r.role === role), null, 2),
        contentType: 'application/json',
      });
      if (ENFORCE) {
        const fresh = results.filter((r) => r.role === role).flatMap((r) => r.newFindings.map((f) => `${r.id} ${formatFinding(f)}`));
        if (fresh.length) throw new Error(`IA-01 budget breaches beyond the ratchet:\n${fresh.join('\n')}`);
      }
    });
  }

  test.afterAll(async () => {
    // Rule 7 across screens: one figure id, one value (per role, one seed).
    const drift = ROLES.flatMap((role) =>
      figureDrift(Object.fromEntries(results.filter((r) => r.role === role && r.counts).map((r) => [r.id, r.counts!.figures]))).map(
        (f) => ({ role, ...f }),
      ),
    );
    const summary = {
      mode: ENFORCE ? 'enforce' : 'report',
      measured: results.filter((r) => r.counts).length,
      withinBudget: results.filter((r) => r.counts && r.findings.length === 0).map((r) => r.id),
      overBudget: results.filter((r) => r.findings.length > 0).map((r) => ({ id: r.id, adopter: r.adopter, findings: r.findings.map(formatFinding) })),
      errors: results.filter((r) => r.error).map((r) => ({ id: r.id, error: r.error })),
      figureDrift: drift,
      screens: results,
    };
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, 'report.json'), JSON.stringify(summary, null, 2));
    console.log(`[IA-01] ${summary.measured} measured · ${summary.withinBudget.length} within · ${summary.overBudget.length} over · report ${join(OUT, 'report.json')}`);
  });
});
