import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { SCREENS, SLACK, TYPE_BUDGET, VIEWPORT, type CopyScreen } from '../lib/copy/screens';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql, loginViaMagicLink } from './helpers';
import { foldContract, measureCopy } from './helpers/copyBudget';

/**
 * W2-16 · Copy focus. Per screen: the word budget ratchet (folds closed; MECHANISM §5.1/§5.4) and the
 * fold contract (§5.5). Non-blocking until W4-01 flips the gates: it prints the gap to the type budget
 * and fails only when a screen GROWS past its recorded baseline (+3 for relative-time strings).
 */
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const EMAIL: Record<string, string> = {
  owner: 'owner@kfar-hazeitim.test',
  manager: 'manager@kfar-hazeitim.test',
  bookkeeper: 'bookkeeper@kfar-hazeitim.test',
  chef: 'chef@kfar-hazeitim.test',
  receiver: 'receiver@kfar-hazeitim.test',
};
const HEARTBEAT = 'e2e-w2-16';

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    const [r] = await sql<{ id: string }[]>`select id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    if (!r) throw new Error('no demo restaurant');
    // The stale-worker banner would count as copy: mock a healthy worker (as W1-05 does).
    await sql`insert into worker_heartbeats (worker_id, host, pid, workers, started_at, beat_at)
              values (${HEARTBEAT}, 'e2e', 1, 1, now(), now() + interval '1 day')
              on conflict (worker_id) do update set beat_at = now() + interval '1 day'`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = e2eSql();
  try {
    await sql`delete from worker_heartbeats where worker_id = ${HEARTBEAT}`;
  } finally {
    await sql.end();
  }
});

// One magic-link sign-in per role for the whole run, cached on disk: Playwright restarts the worker
// after a failing test, and the auth rate limit allows only a few magic links per minute.
const STATE_DIR = 'test-results/.auth';
async function stateFor(browser: Browser, role: string): Promise<string> {
  const file = `${STATE_DIR}/w2-16-${role}.json`;
  if (!existsSync(file)) {
    mkdirSync(STATE_DIR, { recursive: true });
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const p = await ctx.newPage();
    await loginViaMagicLink(p, EMAIL[role]!);
    await ctx.storageState({ path: file });
    await ctx.close();
  }
  return file;
}

async function open(browser: Browser, s: CopyScreen): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: VIEWPORT[s.vp],
    ...(s.role === 'anon' ? {} : { storageState: await stateFor(browser, s.role) }),
  });
  const page = await ctx.newPage();
  await page.goto(s.route);
  await page.waitForLoadState('networkidle');
  return page;
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  const res = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string }> }> } }).axe;
    return axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
  });
  return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

for (const s of SCREENS) {
  test(`copy budget · ${s.id} (${s.role}, ${s.vp})`, async ({ browser }) => {
    const page = await open(browser, s);
    const m = await measureCopy(page);
    const budget = TYPE_BUDGET[s.type];
    const firstBudget = s.type === 'dashboard' && s.vp === 'phone' ? budget.phoneFirst! : budget.first;
    const base = s.baseline === 'type' ? { first: firstBudget, page: budget.page, blocks: budget.blocks } : s.baseline;
    console.info(
      `[W2-16] ${s.id}: first ${m.first} (budget ${firstBudget}, gap ${m.first - firstBudget}) · page ${m.page} (budget ${budget.page}, gap ${m.page - budget.page})` +
        ` · blocks>12 ${m.blocks.length} · body.innerText ${m.bodyWords} · exempt ${m.exemptWords} · baseline ${JSON.stringify(s.baseline)} · ${s.adopter}`,
    );
    if (!base) return; // seed on first run: copy the printed numbers into lib/copy/screens.ts
    expect.soft(m.first, `${s.id} first screen grew`).toBeLessThanOrEqual(base.first + SLACK);
    expect.soft(m.page, `${s.id} page grew`).toBeLessThanOrEqual(base.page + SLACK);
    expect(await foldContract(page)).toEqual([]);
  });
}

test('fold contract + axe with folds open (one real screen)', async ({ browser }) => {
  const s = SCREENS.find((x) => x.id === 'owner-home')!;
  const page = await open(browser, s);
  expect(await axeSerious(page)).toEqual([]);
  const toggles = page.locator('[data-explain-toggle]');
  for (let i = 0; i < (await toggles.count()); i++) if (await toggles.nth(i).isVisible()) await toggles.nth(i).click();
  expect(await axeSerious(page)).toEqual([]);
  // Keyboard: Tab reaches a toggle; Enter and Space flip it.
  if (await toggles.count()) {
    const t = toggles.first();
    await t.focus();
    const before = await t.getAttribute('aria-expanded');
    await page.keyboard.press('Enter');
    expect(await t.getAttribute('aria-expanded')).not.toBe(before);
    await page.keyboard.press('Space');
    expect(await t.getAttribute('aria-expanded')).toBe(before);
  }
});
