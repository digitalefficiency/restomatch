import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { devices, expect, test, type Page } from '@playwright/test';
import { dsHe } from '../lib/i18n/messages/components/ds';
import { en as sEn } from '../lib/i18n/messages/settings/en';
import { he as sHe } from '../lib/i18n/messages/settings/he';
import { SLACK, TYPE_BUDGET } from '../lib/copy/screens';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { collectPageErrors, e2eSql, loginViaMagicLink } from './helpers';
import { foldContract, measureCopy } from './helpers/copyBudget';

/**
 * DS3-06 · settings and personal display preferences (docs/ux/ds3/WORKPLAN.md, DS3-06).
 * Acceptance, as tested here:
 *   - SPEC §10.5 layout: one h1, two groups ("אני", "המסעדה"), a scope chip per section, a search
 *     field that finds any setting; receiver and chef see only "אני".
 *   - Display preferences act at once, are stored per device under the contract's names (rm_density,
 *     rm_text and their rm:density / rm:text mirrors, rm:keys:single) and are in the
 *     first HTML: no attribute changes after hydration ("no preference flashes on load").
 *   - Phone: the settings that do nothing on a phone are absent (density, the side menu, single keys).
 *   - Thresholds: saving writes exactly what settings.update writes and is audited the same way
 *     (settings.updated); ten seconds to undo, waiting while focus is on it; the history; restore
 *     from the history and back to the default (both unsaved); a draft survives another section;
 *     the preview never claims that saving changes a gap that is already open.
 *   - The restaurant's details list who changed them and when (settings.profile_updated).
 *   - Old one-page anchors land on their section; axe WCAG 2.2 AA (0 serious) on every section, in
 *     Hebrew and English; every section within the detail copy budget and the fold contract.
 * DS3_06_SHOTS=1 writes the screens to e2e/__screenshots__/DS3-06/.
 */
test.use({ storageState: OWNER_STATE });

const BASE = '/dashboard/settings';
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SHOTS = process.env.DS3_06_SHOTS ? 'e2e/__screenshots__/DS3-06' : null;
const SECTIONS = [
  'display',
  'account',
  'security',
  'privacy',
  'restaurant',
  'letterhead',
  'rules',
] as const;
const href = (s: (typeof SECTIONS)[number]) => (s === 'display' ? BASE : `${BASE}?s=${s}`);

async function prepare(page: Page, locale: 'he' | 'en', width?: number) {
  const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
  await page.context().addCookies([
    { name: 'rm_locale', value: locale, url },
    { name: 'rm_cookie_consent', value: 'necessary', url },
  ]);
  if (width) await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, caret: 'initial' });
}

async function seriousAxe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    const w = window as unknown as {
      axe: {
        run: (
          c: unknown,
          o: unknown,
        ) => Promise<{
          violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
        }>;
      };
    };
    const res = await w.axe.run(
      { exclude: [['nextjs-portal'], ['[data-worker-status]']] },
      { runOnly: { type: 'tag', values: tags } },
    );
    return res.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .flatMap((v) => v.nodes.map((n) => `${v.id} @ ${n.target.join(' ')}`));
  }, WCAG_AA);
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** One preference cookie's value on this device (the contract: rm_density, rm_text), or null. */
async function prefCookie(page: Page, name: 'rm_density' | 'rm_text'): Promise<string | null> {
  const c = (await page.context().cookies()).find((x) => x.name === name);
  return c ? decodeURIComponent(c.value) : null;
}

/** A localStorage value (the contract: rm:density, rm:text, rm:keys:single), or null. */
const stored = (page: Page, key: string) =>
  page.evaluate((k) => window.localStorage.getItem(k), key);

for (const lang of ['he', 'en'] as const) {
  test(`the frame: one h1, two groups with scope chips, a search that finds any setting (${lang})`, async ({
    page,
  }) => {
    const c = lang === 'he' ? sHe : sEn;
    const errors = collectPageErrors(page);
    await prepare(page, lang, 1440);
    await page.goto(BASE);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveText(c.title);
    const nav = page.getByRole('navigation', { name: c.frame.sectionsAria });
    await expect(nav.getByText(c.frame.groups.me, { exact: true })).toBeVisible();
    await expect(nav.getByText(c.frame.groups.restaurant, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: c.areas.display.title }),
    ).toBeVisible();
    await expect(page.locator('[data-scope="device"]')).toHaveText(c.scope.device);
    await shot(page, `display-${lang}-1440`);
    expect(await seriousAxe(page)).toEqual([]);

    // Each section opens beside the list, with its own scope.
    for (const [s, scope] of [
      ['account', 'user'],
      ['restaurant', 'restaurant'],
    ] as const) {
      await nav.getByRole('link', { name: c.areas[s].title }).click();
      await expect(page).toHaveURL(new RegExp(`[?&]s=${s}`));
      await expect(page.getByRole('heading', { level: 2, name: c.areas[s].title })).toBeVisible();
      await expect(page.locator(`[data-scope="${scope}"]`).first()).toHaveText(c.scope[scope]);
    }

    // The search finds a setting in another section and lands on its row.
    await page.goto(BASE);
    const search = page.getByRole('searchbox', { name: c.frame.searchAria });
    await search.fill(lang === 'he' ? 'מע״מ' : 'VAT');
    const results = page.getByRole('region', { name: c.frame.resultsAria });
    const hit = results.locator('a[href*="s=restaurant#profile"]').first();
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(/[?&]s=restaurant#profile/);
    await expect(
      page.getByRole('heading', { level: 2, name: c.areas.restaurant.title }),
    ).toBeVisible();
    await page.goto(BASE);
    await page.getByRole('searchbox', { name: c.frame.searchAria }).fill('zzzz');
    await expect(page.getByRole('region', { name: c.frame.resultsAria })).toContainText(
      c.frame.noResults,
    );

    // The rules section passes axe too (its fields, chips and preview box).
    await page.goto(`${BASE}?s=rules`);
    await expect(page.getByTestId('rules-in-force')).toBeVisible();
    await shot(page, `rules-${lang}-1440`);
    expect(await seriousAxe(page)).toEqual([]);

    // 390: the sections become a row of chips; nothing scrolls sideways.
    await prepare(page, lang, 390);
    for (const s of ['display', 'rules'] as const) {
      await page.goto(href(s));
      await expect(page.getByRole('heading', { level: 2, name: c.areas[s].title })).toBeVisible();
      expect(await sideways(page), `sideways scroll on ${s} at 390`).toBeLessThanOrEqual(0);
      await shot(page, `${s}-${lang}-390`);
    }
    expect(errors).toEqual([]);
  });
}

test('display preferences act at once, stay on this device and are in the first HTML (no flash)', async ({
  page,
}) => {
  const errors = collectPageErrors(page);
  await prepare(page, 'he', 1440);
  await page.context().clearCookies({ name: 'rm_density' });
  await page.context().clearCookies({ name: 'rm_text' });
  await page.goto(BASE);
  await page.evaluate(() =>
    ['rm:density', 'rm:text', 'rm:keys:single'].forEach((k) => localStorage.removeItem(k)),
  );
  await page.reload();
  const html = page.locator('html');

  await page
    .getByRole('radiogroup', { name: sHe.display.densityTitle })
    .getByRole('radio', { name: sHe.display.compact })
    .click();
  await expect(html).toHaveAttribute('data-density', 'compact');
  await page
    .getByRole('radiogroup', { name: sHe.display.textTitle })
    .getByRole('radio', { name: sHe.display.textLarge })
    .click();
  await expect(html).toHaveAttribute('data-text', 'large');
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('#main-content > *')!).zoom),
  ).toBe('1.1');
  await page.getByRole('switch', { name: sHe.display.keysTitle }).click();
  await expect(page.getByRole('switch', { name: sHe.display.keysTitle })).toHaveAttribute(
    'aria-checked',
    'false',
  );

  // The contract's names and values (three other packages read them).
  expect(await prefCookie(page, 'rm_density')).toBe('compact');
  expect(await prefCookie(page, 'rm_text')).toBe('large');
  expect(await stored(page, 'rm:density')).toBe('compact');
  expect(await stored(page, 'rm:text')).toBe('large');
  expect(await stored(page, 'rm:keys:single')).toBe('0');

  // The first HTML already carries density and text size (the server reads the cookies)…
  const body = await (await page.request.get(BASE)).text();
  expect(body).toContain('data-density="compact"');
  expect(body).toContain('data-text="large"');
  expect(body).toContain('zoom:var(--text-zoom-large,1.1)');

  // …so nothing flips after hydration (the single-key switch appears once, with its stored state).
  await page.addInitScript(() => {
    const w = window as unknown as { __prefsFlips: string[] };
    w.__prefsFlips = [];
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.target instanceof Element && m.target.hasAttribute('data-rm-prefs'))
          w.__prefsFlips.push(String(m.attributeName));
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-density', 'data-text'],
    });
  });
  await page.reload();
  await expect(html).toHaveAttribute('data-density', 'compact');
  await expect(page.getByRole('switch', { name: sHe.display.keysTitle })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect(
    await page.evaluate(() => (window as unknown as { __prefsFlips: string[] }).__prefsFlips),
  ).toEqual([]);

  // Back to the defaults: nothing stored, the owner's regular density and text (no attributes).
  await page.getByRole('button', { name: sHe.display.reset }).click();
  await expect.poll(() => prefCookie(page, 'rm_density')).toBeNull();
  await expect.poll(() => prefCookie(page, 'rm_text')).toBeNull();
  expect(await stored(page, 'rm:keys:single')).toBeNull();
  await expect(html).not.toHaveAttribute('data-density', /.+/);
  await expect(html).not.toHaveAttribute('data-text', /.+/);
  await expect(page.getByRole('switch', { name: sHe.display.keysTitle })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  // Pixel 5: a touch screen and a phone User-Agent (the device type, not the browser).
  const pixel = devices['Pixel 5'];
  test.use({
    viewport: pixel.viewport,
    userAgent: pixel.userAgent,
    deviceScaleFactor: pixel.deviceScaleFactor,
    isMobile: pixel.isMobile,
    hasTouch: pixel.hasTouch,
  });

  test('the settings that do nothing on a phone are absent; density renders regular from the first HTML', async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await prepare(page, 'he');
    const url = test.info().project.use.baseURL ?? 'http://localhost:3100';
    await page.context().addCookies([{ name: 'rm_density', value: 'compact', url }]);

    const body = await (
      await page.request.get(BASE, { headers: { 'user-agent': pixel.userAgent } })
    ).text();
    expect(body).not.toContain('data-density="compact"');

    await page.goto(BASE);
    await expect(page.locator('#text')).toBeVisible();
    for (const id of ['density', 'rail', 'keys']) await expect(page.locator(`#${id}`)).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-density', /.+/);
    await page
      .getByRole('searchbox', { name: sHe.frame.searchAria })
      .fill(sHe.display.densityTitle);
    await expect(page.getByRole('region', { name: sHe.frame.resultsAria })).toContainText(
      sHe.frame.noResults,
    );
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});

test('thresholds: save writes what settings.update writes, audited; 10 s undo; history; a kept draft', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const sql = e2eSql();
  const [restaurant] = await sql<{ id: string; settings: Record<string, unknown> }[]>`
    select id, settings from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
  const id = restaurant!.id;
  const before = restaurant!.settings;
  const pricePercent = async () =>
    (
      await sql<
        { v: string | null }[]
      >`select settings->'tolerances'->>'pricePercent' as v from restaurants where id = ${id}`
    )[0]!.v;
  const lastAudit = async () =>
    (
      await sql<{ action: string; after: { tolerances?: Record<string, number> } }[]>`
        select action, after from audit_log where restaurant_id = ${id} order by at desc limit 1`
    )[0];
  try {
    // Start from the engine default for the price tolerance (no override stored).
    await sql`update restaurants set settings = settings #- '{tolerances,pricePercent}' where id = ${id}`;
    const errors = collectPageErrors(page);
    await prepare(page, 'he', 1440);
    await page.goto(`${BASE}?s=rules`);
    const row = page.locator('#pricePercent');
    const effect = page.getByTestId('threshold-effect');
    await expect(row.getByText(sHe.thresholds.default, { exact: true })).toBeVisible();
    await expect(effect).toContainText(sHe.thresholds.effect.titleSaved);
    await expect(effect).toContainText(sHe.thresholds.effect.applies);

    // A change: marked unsaved, the bar, and the preview in conditional words.
    await row.getByRole('button', { name: dsHe.quantity.increase }).click();
    await expect(page.locator('#set-pricePercent')).toHaveValue('3');
    await expect(row.getByText(sHe.thresholds.unsaved, { exact: true })).toBeVisible();
    const dirtyBar = page.getByTestId('settings-dirty-bar');
    await expect(dirtyBar).toContainText(sHe.thresholds.save.dirty);
    await expect(effect).toContainText(sHe.thresholds.effect.titleUnsaved);
    await expect(effect).toContainText(sHe.thresholds.effect.applies);
    await expect(effect).not.toHaveAttribute('data-stale', /.+/);
    await expect(effect).not.toContainText(/ייסגר|נסגר|יסגרו|נסגרים/);

    // Save: exactly what settings.update writes, audited as settings.updated; focus on "ביטול".
    await dirtyBar.getByRole('button', { name: sHe.thresholds.save.saveCta }).click();
    const undoBar = page.getByTestId('settings-undo-bar');
    await expect(undoBar).toContainText(sHe.thresholds.save.done);
    await expect(undoBar.getByRole('button', { name: sHe.thresholds.save.undoCta })).toBeFocused();
    await expect.poll(pricePercent).toBe('0.03');
    const saved = await lastAudit();
    expect(saved!.action).toBe('settings.updated');
    expect(saved!.after.tolerances?.pricePercent).toBe(0.03);
    await expect(effect).toContainText(sHe.thresholds.effect.titleSaved);
    await expect(effect).toContainText(sHe.thresholds.effect.applies);

    // Undo inside the ten seconds: the override is removed again, and that is audited too.
    await undoBar.getByRole('button', { name: sHe.thresholds.save.undoCta }).click();
    await expect.poll(pricePercent).toBeNull();
    const undone = await lastAudit();
    expect(undone!.action).toBe('settings.updated');
    expect(undone!.after.tolerances?.pricePercent).toBeUndefined();
    await expect(page.locator('#set-pricePercent')).toBeFocused();

    // The history says who changed what.
    const history = page.getByTestId('rules-history');
    await history.getByRole('button', { name: /היסטוריית שינויים/ }).click();
    await expect(history.locator('#rules-history-list')).toContainText(
      sHe.thresholds.fields.pricePercent.label,
    );

    // A draft survives opening another section; the list marks it.
    await row.getByRole('button', { name: dsHe.quantity.increase }).click();
    await expect(dirtyBar).toBeVisible();
    const nav = page.getByRole('navigation', { name: sHe.frame.sectionsAria });
    await nav.getByRole('link', { name: sHe.areas.display.title }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: sHe.areas.display.title }),
    ).toBeVisible();
    await expect(nav.getByRole('link', { name: new RegExp(sHe.frame.unsavedSr) })).toBeVisible();
    await nav.getByRole('link', { name: new RegExp(sHe.areas.rules.title) }).click();
    await expect(page.locator('#set-pricePercent')).toHaveValue('3');
    await dirtyBar.getByRole('button', { name: sHe.thresholds.save.discardCta }).click();
    await expect(dirtyBar).toHaveCount(0);
    await expect(page.locator('#set-pricePercent')).toHaveValue('2');
    expect(await pricePercent()).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await sql`update restaurants set settings = ${sql.json(before as never)} where id = ${id}`;
    await sql.end();
  }
});

test('the undo window waits while focus is on "ביטול" and ends ten seconds after it leaves', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const sql = e2eSql();
  const [restaurant] = await sql<{ id: string; settings: Record<string, unknown> }[]>`
    select id, settings from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
  const id = restaurant!.id;
  const before = restaurant!.settings;
  try {
    await sql`update restaurants set settings = settings #- '{tolerances,pricePercent}' where id = ${id}`;
    const errors = collectPageErrors(page);
    // A clock the test moves (it runs on as usual in between).
    await page.clock.install();
    await prepare(page, 'he', 1440);
    await page.goto(`${BASE}?s=rules`);
    await page
      .locator('#pricePercent')
      .getByRole('button', { name: dsHe.quantity.increase })
      .click();
    await page
      .getByTestId('settings-dirty-bar')
      .getByRole('button', { name: sHe.thresholds.save.saveCta })
      .click();
    const undoBar = page.getByTestId('settings-undo-bar');
    await expect(undoBar.getByRole('button', { name: sHe.thresholds.save.undoCta })).toBeFocused();
    // The pointer away from the bar: only focus holds the time now.
    await page.mouse.move(4, 4);
    await page.clock.fastForward(12_000);
    await expect(undoBar).toBeVisible();
    // Focus leaves the bar: ten seconds from now it goes, and the history may restore again.
    await page.locator('#set-pricePercent').focus();
    await page.clock.fastForward(9_000);
    await expect(undoBar).toBeVisible();
    await page.clock.fastForward(1_500);
    await expect(undoBar).toHaveCount(0);
    await expect(page.locator('#set-pricePercent')).toBeFocused();
    expect(
      (
        await sql<
          { v: string | null }[]
        >`select settings->'tolerances'->>'pricePercent' as v from restaurants where id = ${id}`
      )[0]!.v,
    ).toBe('0.03');

    // Restore from the history: the previous values come back as an unsaved change, focus on "שמרו".
    const row = page.locator('#pricePercent');
    const dirtyBar = page.getByTestId('settings-dirty-bar');
    const history = page.getByTestId('rules-history');
    await history.getByRole('button', { name: /היסטוריית שינויים/ }).click();
    await history.getByRole('button', { name: sHe.thresholds.history.restoreCta }).click();
    await expect(page.locator('#set-pricePercent')).toHaveValue('2');
    await expect(row.getByText(sHe.thresholds.unsaved, { exact: true })).toBeVisible();
    await expect(dirtyBar).toBeVisible();
    await expect(page.locator('#settings-save-cta')).toBeFocused();
    await dirtyBar.getByRole('button', { name: sHe.thresholds.save.discardCta }).click();
    await expect(page.locator('#set-pricePercent')).toHaveValue('3');

    // The field's own "חזרה לברירת המחדל": the default, unsaved, focus on the field.
    await row
      .getByRole('button', {
        name: sHe.thresholds.restoreDefaultAria.replace(
          '{field}',
          sHe.thresholds.fields.pricePercent.label,
        ),
      })
      .click();
    await expect(page.locator('#set-pricePercent')).toHaveValue('2');
    await expect(row.getByText(sHe.thresholds.unsaved, { exact: true })).toBeVisible();
    await expect(page.locator('#set-pricePercent')).toBeFocused();
    await dirtyBar.getByRole('button', { name: sHe.thresholds.save.discardCta }).click();
    await expect(dirtyBar).toHaveCount(0);
    // Nothing was saved by either restore.
    expect(
      (
        await sql<
          { v: string | null }[]
        >`select settings->'tolerances'->>'pricePercent' as v from restaurants where id = ${id}`
      )[0]!.v,
    ).toBe('0.03');
    expect(errors).toEqual([]);
  } finally {
    await sql`update restaurants set settings = ${sql.json(before as never)} where id = ${id}`;
    await sql.end();
  }
});

test('restaurant details: a change is listed with who and when (settings.profile_updated)', async ({
  page,
}) => {
  const sql = e2eSql();
  const [restaurant] = await sql<{ id: string; business_id: string | null }[]>`
    select id, business_id from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
  const id = restaurant!.id;
  const before = restaurant!.business_id;
  try {
    const errors = collectPageErrors(page);
    await prepare(page, 'he', 1440);
    await page.goto(`${BASE}?s=restaurant`);
    // One title for the section: the form under it has none of its own.
    await expect(page.getByRole('heading', { name: sHe.areas.restaurant.title })).toHaveCount(1);
    const next = before === '512345674' ? '513456782' : '512345674';
    await page.locator('#prof-biz').fill(next);
    await page.getByRole('button', { name: sHe.profile.save }).click();
    await expect(page.getByText(sHe.profile.saved)).toBeVisible();
    const history = page.getByTestId('profile-history');
    await history.getByRole('button', { name: /היסטוריית שינויים/ }).click();
    const latest = history.locator('#profile-history-list > li').first();
    await expect(latest).toContainText(sHe.profile.businessId);
    await expect(latest).toContainText(next);
    expect(errors).toEqual([]);
  } finally {
    await sql`update restaurants set business_id = ${before} where id = ${id}`;
    await sql.end();
  }
});

for (const lang of ['he', 'en'] as const) {
  test(`axe WCAG 2.2 AA: no serious violation on any section (${lang})`, async ({ page }) => {
    const titles = lang === 'he' ? sHe.areas : sEn.areas;
    await prepare(page, lang, 1440);
    for (const s of SECTIONS) {
      await page.goto(href(s));
      await expect(page.getByRole('heading', { level: 2, name: titles[s].title })).toBeVisible();
      expect(await seriousAxe(page), `${lang} · ${s}`).toEqual([]);
    }
  });
}

test('old one-page anchors land on their section', async ({ page }) => {
  await prepare(page, 'he', 1440);
  await page.goto(`${BASE}#letterhead`);
  await expect(page).toHaveURL(/[?&]s=letterhead#letterhead/);
  await expect(page.getByTestId('letterhead-form')).toBeVisible();
  await page.goto(`${BASE}#rules`);
  await expect(page).toHaveURL(/[?&]s=rules/);
  await expect(page.getByTestId('rules-in-force')).toBeVisible();
});

/**
 * The rules section holds twelve fields with their hints and limits: its first screen is over the
 * detail budget (110 words). Its first measurement is recorded here as its baseline, as the copy
 * ratchet does for a new screen (lib/copy/screens.ts): only ever lowered. Owner decision in the PR.
 */
const RULES_BASELINE = {
  ...TYPE_BUDGET.detail,
  // Measured 21.11.2026 (e2e seed, he, 1440): first 146, page 267, blocks 0. Only the first screen is over.
  first: 146,
};

test('every section stays within the detail copy budget (the rules section within its baseline) and the fold contract', async ({
  page,
}) => {
  await prepare(page, 'he', 1440);
  const measured: Array<{
    s: (typeof SECTIONS)[number];
    first: number;
    page: number;
    blocks: number;
    folds: string[];
  }> = [];
  for (const s of SECTIONS) {
    await page.goto(href(s));
    await expect(page.getByRole('heading', { level: 2, name: sHe.areas[s].title })).toBeVisible();
    const m = await measureCopy(page);
    measured.push({
      s,
      first: m.first,
      page: m.page,
      blocks: m.blocks.length,
      folds: await foldContract(page),
    });
  }
  console.log(
    `[DS3-06 copy] ${measured.map((m) => `${m.s}: first ${m.first}, page ${m.page}, blocks ${m.blocks}`).join(' · ')}`,
  );
  for (const m of measured) {
    const budget = m.s === 'rules' ? RULES_BASELINE : TYPE_BUDGET.detail;
    expect(m.first, `${m.s}: first-screen words`).toBeLessThanOrEqual(budget.first + SLACK);
    expect(m.page, `${m.s}: page words`).toBeLessThanOrEqual(budget.page + SLACK);
    expect(m.blocks, `${m.s}: blocks over 12 words`).toBeLessThanOrEqual(budget.blocks);
    expect(m.folds, `${m.s}: folds`).toEqual([]);
  }
});

test.describe('roles', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('receiver: only "אני"; a restaurant section answers with the shell\'s 403 wording', async ({
    page,
  }) => {
    await prepare(page, 'he', 1440);
    await loginViaMagicLink(page, 'receiver@kfar-hazeitim.test', BASE);
    await page.goto(BASE);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(
      page.locator('a[href*="s=rules"], a[href*="s=restaurant"], a[href*="s=letterhead"]'),
    ).toHaveCount(0);
    await page.goto(`${BASE}?s=rules`);
    await expect(page.getByRole('heading', { level: 2 })).toContainText(
      /לא פתוח לתפקיד שלכם|isn't open to your role/,
    );
    await expect(page.getByTestId('rules-in-force')).toHaveCount(0);
  });

  test('chef: only "אני", like the receiver', async ({ page }) => {
    await prepare(page, 'he', 1440);
    await loginViaMagicLink(page, 'chef@kfar-hazeitim.test', BASE);
    await page.goto(BASE);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(
      page.locator('a[href*="s=rules"], a[href*="s=restaurant"], a[href*="s=letterhead"]'),
    ).toHaveCount(0);
    await page.goto(`${BASE}?s=restaurant`);
    await expect(page.getByRole('heading', { level: 2 })).toContainText(
      /לא פתוח לתפקיד שלכם|isn't open to your role/,
    );
  });

  test('manager: the rules are shown read-only, with the history', async ({ page }) => {
    await prepare(page, 'he', 1440);
    await loginViaMagicLink(page, 'manager@kfar-hazeitim.test', BASE);
    await page.goto(`${BASE}?s=rules`);
    await expect(page.getByTestId('rules-in-force')).toBeVisible();
    await expect(page.locator('#set-pricePercent')).toBeDisabled();
    await expect(page.getByTestId('rules-history')).toBeVisible();
    await expect(page.getByTestId('settings-dirty-bar')).toHaveCount(0);
  });
});
