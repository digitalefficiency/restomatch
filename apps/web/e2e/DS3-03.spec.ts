import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { he as leaksHe } from '../lib/i18n/messages/leaks/he';
import { en as navEn } from '../lib/i18n/messages/nav/en';
import { he as navHe } from '../lib/i18n/messages/nav/he';
import { en as ovEn } from '../lib/i18n/messages/overview/en';
import { he as ovHe } from '../lib/i18n/messages/overview/he';
import { interpolate } from '../lib/i18n/translate';
import { DEMO_RESTAURANT_NAME, OWNER_STATE } from './env';
import { e2eSql, expectTotalsMatchRows, HEBREW } from './helpers';
import type { DensityCounts } from './ia/budget';
import { measureDensity } from './ia/meter';
import { BASELINE_0711 } from './ia/screens';
import { seedMonthFacts } from './seededMonth';

/**
 * DS3-03 · The owner home in the clean finish (DS3 SPEC §10.1; design v4 H1–H13), in a real browser:
 *
 *  - the leak card: no rail and no danger frame; the red dot (leak only) and the period beside the
 *    label; the one number = owner.leakHero to the agora; the scale sentence, the change in words,
 *    the split (bar + legend when both parts are ≥ ₪0.50, else one sentence), the completeness line;
 *  - the pace line: named in words, the drawing hidden, no figure of its own;
 *  - "איך הגענו לסכום?": opens in place, focus stays on the toggle, the rows add up to the hero
 *    (G-16 markers), inert again once closed;
 *  - "מחכה לך": ≥48 px rows in `ul[data-record]` lists, the blocking pill inside the sub line, one
 *    filled verb, "עוד" moves focus to the first revealed row;
 *  - "הוחזר החודש": the round tick, the amount in the recovered role;
 *  - numbers in the first fold under data-independent ceilings per zone (v4 H11), one filled
 *    primary at 1440×900;
 *  - the phone (390×844, touch): the ₪ in the fold, 44 px targets, the reading order;
 *  - motion: reduce → nothing runs and the final figure shows at once; no preference →
 *    `data-entry` on load, removed after the entry, the number never rewritten; a client Back
 *    replays nothing;
 *  - English once; the manager's and the bookkeeper's lens unchanged.
 *
 * The e2e seed dates everything from today (DEMO_TODAY unpinned): a step whose state the seed day
 * does not produce is skipped with its reason, never loosened.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const DESK = { width: 1440, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const TZ = 'Asia/Jerusalem';
const DAY_MS = 86_400_000;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'RestoMatch-Demo-2026!';
const HEARTBEAT = 'e2e-ds3-03';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const BIDI = /[‎‏‪-‮⁦-⁩]/g;

type Locale = 'he' | 'en';
type HeroState = 'leak' | 'clean' | 'pendingOnly' | 'noData';

/** v4 H11: numbers in the first fold per zone, by hero state (data-independent ceilings). */
const HERO_CEILING: Record<HeroState, number> = { leak: 9, clean: 8, pendingOnly: 7, noData: 1 };

interface HeroFigures {
  monthStart: string;
  monthEnd: string;
  leakIls: number;
  spendIls: number;
  leakPct: number | null;
  caughtBeforePaymentIls: number;
  matchedInvoiceCount: number;
  invoicesWithLeak: number;
}

interface LeakReport {
  hero: { monthStart: string; leakIls: number; invoicesWithLeak: number };
  byType: { type: string; count: number; amountIls: number }[];
  capAdjustmentIls: number;
}

test.beforeAll(async () => {
  const sql = e2eSql();
  try {
    // The lab worker banner would sit above the fold: mock a healthy worker (as W1-05 / W2-08 do).
    await sql`insert into worker_heartbeats (worker_id, host, pid, workers, started_at, beat_at)
              values (${HEARTBEAT}, 'e2e', 1, 1, now(), now() + interval '1 day')
              on conflict (worker_id) do update set beat_at = now() + interval '1 day'`;
    // The serial run shares one login budget per IP (helpers.ts ensurePasswordUser): start from a clean throttle.
    await sql`delete from rate_limit_counters where key like 'login:%'`;
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

/* ─────────────────────────────── helpers ─────────────────────────────── */

/** The first number in a text (₪ figures carry RLM marks and grouping commas). */
function num(text: string): number {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(text.replace(BIDI, ' '));
  if (!m) throw new Error(`no number in ${JSON.stringify(text)}`);
  return Number(m[0].replace(/,/g, ''));
}

const agorotOf = (ils: number) => Math.round(ils * 100);
const monthName = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', { month: 'long', timeZone: TZ }).format(new Date(iso));
const israelDay = () => Number(new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: TZ }).format(new Date()));

async function cookies(context: BrowserContext, baseURL: string, locale: Locale) {
  await context.addCookies([
    { name: 'rm_cookie_consent', value: 'necessary', url: baseURL },
    { name: 'rm_locale', value: locale, url: baseURL },
  ]);
}

/** A tRPC query as the page's user (the W2-08 pattern): the procedure's own figures. */
async function trpc<T>(page: Page, path: string, input: unknown = {}): Promise<T> {
  const res = await page.request.get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
  return ((await res.json()) as { result: { data: { json: T } } }).result.data.json;
}

/** /dashboard with the leak card on screen; its state checked against the seed's own facts (W1-05's oracle). */
async function openHome(page: Page): Promise<{ hero: Locator; state: HeroState }> {
  await page.goto('/dashboard');
  const hero = page.getByTestId('leak-hero');
  await expect(hero).toBeVisible();
  const state = (await hero.getAttribute('data-state')) as HeroState;
  const seeded = await seedMonthFacts(0);
  if (seeded.leakFindings > 0) expect(state, `oracle: ${seeded.leakFindings} seeded leak findings this month → 'leak'`).toBe('leak');
  else if (seeded.matchedInvoices > 0) expect(['leak', 'clean'], `oracle: ${seeded.matchedInvoices} checked invoices`).toContain(state);
  else expect(['leak', 'clean', 'noData', 'pendingOnly']).toContain(state);
  return { hero, state };
}

/**
 * The lab runs no worker, so every dashboard page shows the warn-toned "מנוע העיבוד לא זמין"
 * status banner (dashboard/worker-status.tsx). Production runs jobs in Vercel cron and never
 * shows it; counting it would add a T2 mark, a block and ~20 words to every screen.
 * (A verbatim copy of IA-01.spec.ts — it is not exported.)
 */
const WORKER_BANNER_TITLES = [navHe.worker.title, navEn.worker.title];

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

/** As IA-01 measures (networkidle + 500 ms for late islands), once the entry motion has ended. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="leak-hero"][data-entry]')).toHaveCount(0);
  await stripLabOnlyBanners(page);
}

/** The shared meter (e2e/ia/meter.ts) with some zones hidden (visibility only: nothing moves). */
async function measureWithHidden(page: Page, hidden: string[]): Promise<DensityCounts> {
  await page.evaluate((selectors) => {
    const style = document.createElement('style');
    style.id = 'ds3-03-zone';
    style.textContent = selectors.map((s) => `${s}, ${s} * { visibility: hidden !important; }`).join('\n');
    document.head.append(style);
  }, hidden);
  try {
    return await measureDensity(page);
  } finally {
    await page.evaluate(() => document.getElementById('ds3-03-zone')?.remove());
  }
}

/** Numbers in the first fold inside `zone` (with `except` hidden first): the meter with and without it. */
async function zoneNumbers(page: Page, zone: string, except: string[] = []): Promise<number> {
  const withZone = await measureWithHidden(page, except);
  const without = await measureWithHidden(page, [...except, zone]);
  return withZone.numbers - without.numbers;
}

/** The danger family as the browser reports it (`rgb(r, g, b)`), from the token variables. */
async function dangerColours(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return ['', '-bold', '-bold-hover', '-subtle', '-subtle-hover', '-border-subtle', '-dot']
      .map((suffix) => root.getPropertyValue(`--c-danger${suffix}`).trim().split(/\s+/).map(Number))
      .filter((p) => p.length === 3 && p.every((x) => Number.isFinite(x)))
      .map((p) => `rgb(${p.join(', ')})`);
  });
}

/** A role class's colour as the browser computes it (a throwaway probe element). */
async function roleColour(page: Page, className: string, property: 'color' | 'backgroundColor'): Promise<string> {
  return page.evaluate(
    ([cls, prop]) => {
      const probe = document.createElement('span');
      probe.className = cls;
      document.body.append(probe);
      const value = getComputedStyle(probe)[prop];
      probe.remove();
      return value;
    },
    [className, property] as const,
  );
}

/** Running animations of the hero's entry (`rm-hero-*`) or on anything inside the leak card. */
async function runningHeroAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return String((a as CSSAnimation).animationName ?? '').startsWith('rm-hero-') || Boolean(target?.closest('[data-testid="leak-hero"]'));
      })
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return `${(a as CSSAnimation).animationName ?? a.constructor.name} on ${target?.tagName ?? '?'}`;
      }),
  );
}

async function axeSerious(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (d: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, exclude: [['[data-testid="worker-status"]']] } as object);
    return r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id} (${v.nodes.length})`);
  });
}

/** The top of the fixed bottom nav on a phone (the fold a finger sees), else the viewport. */
async function foldBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav')].find((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().top > 300);
    return nav ? nav.getBoundingClientRect().top : window.innerHeight;
  });
}

/* ─────────────────────────────── owner · desk ─────────────────────────────── */

test.describe('owner · desk 1440×900', () => {
  test.use({ storageState: OWNER_STATE, viewport: DESK });
  test.beforeEach(async ({ context, baseURL }) => cookies(context, baseURL!, 'he'));

  test('the leak card: no rail or danger frame, the dot and the period, the exact figure, the scale, the change, the split', async ({ page }) => {
    const { hero, state } = await openHome(page);
    const figures = await trpc<HeroFigures>(page, 'owner.leakHero');
    const heroAgorot = agorotOf(figures.leakIls);
    const danger = await dangerColours(page);
    expect(danger.length, 'the danger tokens resolve').toBeGreaterThan(3);

    // A card like every card (SPEC §2 T1: the leak is the 8 px dot): one border width all round, never a danger colour, no rail.
    const frame = await hero.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        widths: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        colours: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor],
        rails: [...el.children].filter((c) => {
          const b = c.getBoundingClientRect();
          return getComputedStyle(c).position === 'absolute' && b.height >= r.height * 0.6 && b.width <= 8;
        }).length,
      };
    });
    expect(new Set(frame.widths).size, `one border width all round: ${frame.widths.join(' ')}`).toBe(1);
    for (const colour of frame.colours) expect(danger, `hero border ${colour}`).not.toContain(colour);
    expect(frame.rails, 'no rail on the start edge').toBe(0);

    // The label exactly, the dot before it (leak only), the period beside it — outside the h2.
    await expect(hero.locator('#leak-hero-label')).toHaveText(ovHe.hero.leakedLabel);
    await expect(hero.locator('[data-dot="leak"]')).toHaveCount(state === 'leak' ? 1 : 0);
    if (state === 'leak') await expect(hero.locator('[data-dot="leak"] + #leak-hero-label')).toHaveCount(1);
    await expect(hero.locator('#leak-hero-label [data-testid="leak-hero-period"]')).toHaveCount(0);
    if (state === 'noData') {
      await expect(hero.getByTestId('leak-hero-period')).toHaveCount(0);
      await expect(hero.getByTestId('leak-hero-amount')).toHaveText('—');
      test.skip(true, 'the seed day has no checked invoice yet: the figure, the scale and the split are not drawn');
    }
    await expect(hero.getByTestId('leak-hero-period')).toHaveText(interpolate(ovHe.hero.period, { month: monthName(figures.monthStart, 'he') }));
    await expect(hero).not.toContainText('יעד');

    const amount = hero.getByTestId('leak-hero-amount');
    if (state === 'pendingOnly') {
      // Unknown is never ₪0 (IA rule 8): "—", and the waiting lines (T4) in their place.
      await expect(amount).toHaveText('—');
      await expect(hero.getByTestId('leak-hero-pending')).toBeVisible();
      test.skip(true, 'the seed day has only invoices waiting for an order link: no figure to check yet');
    }

    // The one number: owner.leakHero to the agora (data-money-agorot), shown at whole shekels, the drill link on the number itself.
    await expect(amount).toHaveAttribute('data-money-agorot', String(heroAgorot));
    expect(num(await amount.innerText()), 'the hero figure').toBe(Math.round(figures.leakIls));
    await expect(amount).toHaveAttribute('href', '/dashboard/leaks/breakdown');

    // The scale sentence: the % bold, the glossary's words, the base with its basis.
    const pct = hero.getByTestId('leak-hero-pct');
    await expect(pct).toBeVisible();
    const bold = pct.locator('b');
    if (await bold.count()) {
      expect(figures.leakPct, 'a % only with spend').not.toBeNull();
      const expected = new Intl.NumberFormat('he-IL', { style: 'percent', maximumFractionDigits: 1 }).format(figures.leakPct!);
      expect((await bold.innerText()).replace(BIDI, '').trim()).toBe(expected.replace(BIDI, ''));
      await expect(pct).toContainText(ovHe.hero.pctOfChecked);
    }
    if (figures.spendIls > 0) expect(num(await hero.getByTestId('leak-hero-base').innerText()), 'the base').toBe(Math.round(figures.spendIls));

    // The change against the same days last month, in words; a money figure is never red.
    const delta = hero.getByTestId('leak-hero-delta');
    await expect(delta).toBeVisible();
    const direction = await delta.getAttribute('data-direction');
    expect(['up', 'down', 'same', 'none']).toContain(direction);
    if (direction === 'none') await expect(delta).toHaveText(ovHe.hero.delta.none);
    else {
      const prevMonth = monthName(new Date(Date.parse(figures.monthStart) - DAY_MS).toISOString(), 'he');
      await expect(delta).toContainText(interpolate(ovHe.hero.delta.vsSameDays, { month: prevMonth }));
      expect(danger, 'the change is never red').not.toContain(await delta.locator(':scope > span').last().evaluate((el) => getComputedStyle(el).color));
    }
    for (const colour of await page.locator('main [data-money-figure]').evaluateAll((els) => els.map((el) => getComputedStyle(el).color))) {
      expect(danger, 'a money figure is never red').not.toContain(colour);
    }

    if (state === 'clean') {
      await expect(hero.getByTestId('leak-hero-clean')).toHaveText(interpolate(ovHe.hero.clean, { count: figures.matchedInvoiceCount }, 'he-IL'));
      await expect(hero.locator('[data-split-bar]')).toHaveCount(0);
      test.skip(true, 'the seed day leaves a clean month: no split, no completeness line');
    }

    // The split (leakSplit's parts, exact agorot): bar + legend when both parts are ≥ ₪0.50, else one sentence.
    const unpaid = Math.min(heroAgorot, Math.max(0, agorotOf(figures.caughtBeforePaymentIls)));
    const paid = heroAgorot - unpaid;
    test.info().annotations.push({ type: 'split', description: `${unpaid >= 50 && paid >= 50 ? 'bar + legend' : 'one sentence'} (unpaid ${unpaid} · paid ${paid} agorot)` });
    if (unpaid >= 50 && paid >= 50) {
      await expect(hero.locator('[data-split-bar]')).toHaveCount(1);
      await expect(hero.locator('[role="group"]')).toHaveAttribute('aria-label', ovHe.hero.splitAria);
      const value = (id: string) => hero.getByTestId(id).locator('[data-money-row-of="hero-split"]');
      await expect(value('hero-unpaid')).toHaveAttribute('data-money-agorot', String(unpaid));
      await expect(value('hero-paid')).toHaveAttribute('data-money-agorot', String(paid));
      await expect(amount).toHaveAttribute('data-money-sum-of', 'hero-split');
      expect(await expectTotalsMatchRows(page), 'the legend adds up to the hero (G-16)').toEqual([]);
      await expect(hero.getByTestId('hero-unpaid-link')).toHaveText(ovHe.hero.unpaidLink);
      await expect(hero.getByTestId('hero-unpaid-link')).toHaveAttribute('href', '/dashboard/leaks/breakdown#group-unpaid');
      await expect(hero.getByTestId('hero-paid-link')).toHaveText(ovHe.hero.paidLink);
      await expect(hero.getByTestId('hero-paid-link')).toHaveAttribute('href', '/dashboard/leaks/claims');
      await expect(hero.getByTestId('hero-split-single')).toHaveCount(0);
    } else {
      // Ties go to the unpaid side (the first part).
      const unpaidSide = unpaid >= paid;
      await expect(hero.locator('[data-split-bar]')).toHaveCount(0);
      const single = hero.getByTestId('hero-split-single');
      await expect(single).toContainText(unpaidSide ? ovHe.hero.allUnpaid : ovHe.hero.allPaid);
      const link = single.getByTestId(unpaidSide ? 'hero-unpaid-link' : 'hero-paid-link');
      await expect(link).toHaveText(unpaidSide ? ovHe.hero.allUnpaidLink : ovHe.hero.paidLink);
      await expect(link).toHaveAttribute('href', unpaidSide ? '/dashboard/leaks/breakdown#group-unpaid' : '/dashboard/leaks/claims');
      await expect(amount).not.toHaveAttribute('data-money-sum-of');
    }

    // The foot line: how many invoices were checked and in how many a gap was found (plain text, no link).
    const completeness = hero.getByTestId('leak-hero-completeness');
    await expect(completeness).toHaveText(
      interpolate(ovHe.hero.checkedLine, { total: figures.matchedInvoiceCount, withLeak: figures.invoicesWithLeak }, 'he-IL'),
    );
    expect(await completeness.evaluate((el) => el.tagName)).not.toBe('A');
  });

  test('the pace line: named in words, the drawing hidden, no figure of its own', async ({ page }) => {
    const { hero, state } = await openHome(page);
    test.skip(state !== 'leak', `the pace line is drawn in the leak state only (seed day: ${state})`);
    test.skip(israelDay() < 2, 'the pace line starts on the 2nd of the month (Israel time)');
    const figures = await trpc<HeroFigures>(page, 'owner.leakHero');
    const figure = hero.getByTestId('leak-hero-pace');
    await expect(figure).toBeVisible();
    await expect(figure.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    const month = monthName(figures.monthStart, 'he');
    const legend = figure.locator('figcaption > span');
    const label = (await figure.getAttribute('aria-label')) ?? '';
    test.info().annotations.push({ type: 'pace', description: label });
    if ((await legend.count()) === 2) {
      const prevMonth = monthName(new Date(Date.parse(figures.monthStart) - DAY_MS).toISOString(), 'he');
      const direction = (await hero.getByTestId('leak-hero-delta').getAttribute('data-direction')) as 'up' | 'down' | 'same';
      expect(label).toBe(interpolate(ovHe.hero.pace.aria, { month, prevMonth, trend: interpolate(ovHe.hero.pace.trend[direction], { prevMonth }) }));
      await expect(legend).toHaveText([month, interpolate(ovHe.hero.pace.prev, { month: prevMonth })]);
    } else {
      // No comparable days last month: the current line alone, no dashed legend, no comparison in its name.
      expect(label).toBe(interpolate(ovHe.hero.pace.ariaCurOnly, { month }));
      await expect(legend).toHaveText([month]);
    }
    // The running totals are geometry only (v2 D6): no digit in the figure's text, name or titles.
    const digits = await figure.evaluate((el) => ({
      text: el.textContent ?? '',
      names: [el, ...el.querySelectorAll('*')].flatMap((n) => [n.getAttribute('aria-label') ?? '', n.getAttribute('title') ?? '']).join(' '),
      titles: [...el.querySelectorAll('title')].map((t) => t.textContent ?? '').join(' '),
    }));
    expect(digits.text, 'figure text').not.toMatch(/\d/);
    expect(digits.names, 'figure names').not.toMatch(/\d/);
    expect(digits.titles, 'svg titles').not.toMatch(/\d/);
  });

  test('"איך הגענו לסכום?": opens in place, focus stays on the toggle, the rows add up to the hero, inert once closed', async ({ page }) => {
    const { hero, state } = await openHome(page);
    test.skip(state !== 'leak', `the calculation opens in the leak state only (seed day: ${state})`);
    await settle(page);
    const figures = await trpc<HeroFigures>(page, 'owner.leakHero');
    const heroAgorot = agorotOf(figures.leakIls);

    const fold = hero.getByTestId('hero-why');
    const toggle = hero.getByTestId('hero-why-toggle');
    await expect(toggle).toHaveText(ovHe.needs.why);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).not.toHaveAttribute('data-explain-toggle');
    const panelId = await toggle.getAttribute('aria-controls');
    expect(panelId, 'the toggle names its panel').toMatch(/^fold-/);
    const region = page.locator(`[id="${panelId}"]`);
    await expect(region).toHaveAttribute('role', 'region');
    await expect(region).toHaveAttribute('aria-label', ovHe.hero.calcAria);
    await expect(region).toHaveAttribute('inert', '');
    await expect(region).toBeHidden();

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(fold).toHaveAttribute('data-open', 'true');
    await expect(toggle, 'focus stays on the toggle').toBeFocused();
    await expect(region).not.toHaveAttribute('inert');
    await expect(region).toBeVisible();

    // The rows, read on this first open (owner.leakReport for the hero's own month), shown only when they prove this hero.
    const calc = hero.getByTestId('hero-calc');
    await expect(calc, 'the rows load (not "לא נטען", not "הסכום התעדכן")').toBeVisible({ timeout: 30_000 });
    const month = new Date((Date.parse(figures.monthStart) + Date.parse(figures.monthEnd)) / 2).toISOString().slice(0, 7);
    const report = await trpc<LeakReport>(page, 'owner.leakReport', { month });
    const gaps = report.byType.reduce((sum, row) => sum + row.count, 0);
    test.info().annotations.push({ type: 'calc', description: `${report.byType.length} rows · ${gaps} gaps · cap ${report.capAdjustmentIls}` });
    await expect(calc.locator('h3')).toHaveText(interpolate(ovHe.hero.calcTitle, { gaps, invoices: report.hero.invoicesWithLeak }, 'he-IL'));
    await expect(calc.getByTestId('hero-calc-row')).toHaveCount(report.byType.length);
    const rows = calc.locator('[data-money-row-of="hero-calc"]');
    expect(await rows.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-money-agorot'))))).toEqual(report.byType.map((row) => agorotOf(row.amountIls)));
    const total = calc.locator('[data-money-sum-of="hero-calc"]');
    await expect(total, "the panel's total is the hero, to the agora").toHaveAttribute('data-money-agorot', String(heroAgorot));
    if (agorotOf(report.capAdjustmentIls) > 0) await expect(total).toHaveAttribute('data-money-cap-agorot', String(heroAgorot));
    expect(await expectTotalsMatchRows(page), 'every total equals its rows (G-16: hero-split and hero-calc)').toEqual([]);

    // The rule in words, what is not counted as a list, the full breakdown.
    await expect(hero.getByTestId('hero-calc-rule')).toContainText(ovHe.hero.calcCounted);
    await expect(hero.getByTestId('hero-calc-excluded').locator('li').last()).toHaveText(ovHe.hero.calcNotDuplicate);
    const flags = await trpc<{ leakProof: boolean }>(page, 'recovery.flags');
    await expect(hero.getByTestId('hero-proof')).toHaveAttribute('href', flags.leakProof ? '/dashboard/leaks/proof' : '/dashboard/leaks/breakdown');
    await page.waitForTimeout(400); // the rows have finished growing (the medium duration)
    expect(await axeSerious(page), 'axe with the calculation open').toEqual([]);

    // Closing: focus stays, the panel leaves the tab order and the accessibility tree.
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).toHaveAttribute('data-open', 'false');
    await expect(toggle).toBeFocused();
    await expect(region).toHaveAttribute('inert', '');
    await expect(region).toBeHidden();
  });

  test('"מחכה לך": ≥48 px rows in data-record lists, the blocking pill inside the sub line, one filled verb', async ({ page }) => {
    await page.goto('/dashboard');
    const card = page.getByTestId('needs-you');
    await expect(card).toBeVisible();
    await expect(card.locator('#needs-you-title')).toHaveText(ovHe.needs.title);
    test.skip((await card.getByTestId('needs-you-zero').count()) > 0, 'the seed day leaves the owner no task: there are no rows to check');

    const rows = card.locator('[data-needs-list="shown"] > li[data-needs-row] > a');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const row of await rows.all()) {
      await expect(row).toBeVisible();
      expect((await row.boundingBox())!.height, 'a whole-row target').toBeGreaterThanOrEqual(48);
      await expect(row, 'the focus ring is drawn inside the clipped card').toHaveAttribute('data-focus', 'inset');
    }
    // The markup contract the meters read: ul[data-record] > li[data-needs-row] > a; never display:contents; the fold has its own list.
    const contract = await card.evaluate((el) => {
      const items = [...el.querySelectorAll('li[data-needs-row]')];
      return {
        outsideARecordList: items.filter((li) => !li.parentElement?.matches('ul[data-record]')).length,
        displayContents: items.filter((li) => getComputedStyle(li).display === 'contents').length,
        nestedLists: el.querySelectorAll('ul[data-record] ul').length,
        primaryInMain: document.querySelectorAll('main [data-primary]').length,
        primaryOnRow0: el.querySelectorAll('[data-needs-list="shown"] > li:first-child > a[data-primary-row] [data-primary]').length,
      };
    });
    expect(contract).toEqual({ outsideARecordList: 0, displayContents: 0, nestedLists: 0, primaryInMain: 1, primaryOnRow0: 1 });
    const hidden = await card.locator('[data-needs-list="more"] > li[data-needs-row]').count();
    test.info().annotations.push({ type: 'needs', description: `${await rows.count()} rows shown · ${hidden} behind "עוד"` });

    // The decision row: its blockers are the solid pill INSIDE the sub line, after an announced separator; its dot is red only then.
    const decide = card.getByTestId('needs-decide');
    if (await decide.count()) {
      const summary = await trpc<{ count: number; blockers: number }>(page, 'approvals.queueSummary');
      test.info().annotations.push({ type: 'decision', description: `${summary.count} gaps · ${summary.blockers} blocking` });
      const sub = card.getByTestId('needs-decide-sub');
      const pill = sub.locator('[data-pill="solid"]');
      if (summary.blockers > 0) {
        const words = interpolate(ovHe.needs.blocking, { count: summary.blockers }, 'he-IL');
        await expect(pill).toHaveText(words);
        await expect(sub).toContainText(`· ${words}`);
        await expect(decide.locator('[data-dot="leak"]')).toHaveCount(1);
      } else {
        await expect(pill).toHaveCount(0);
        await expect(decide.locator('[data-dot="leak"]')).toHaveCount(0);
      }
    }
  });

  test('"עוד": the rows beyond three unfold above the button; focus moves to the first revealed row, closing leaves it on the button', async ({ page }) => {
    // The seed leaves the owner three tasks: one photo invoice whose reading failed (W2-08's fixture) adds a
    // fourth ("חשבוניות שממתינות לכם"), so one row waits behind "עוד". Removed again at the end.
    const NUMBER = 'E2E-DS303-MORE';
    const sql = e2eSql();
    try {
      await sql`delete from invoices where invoice_number = ${NUMBER}`;
      await sql`insert into invoices (restaurant_id, invoice_number, invoice_date, status, source, ocr_payload)
                select id, ${NUMBER}, now(), 'parsed', 'photo', ${sql.json({ raw: { ocrFailed: true } })}
                from restaurants where name = ${DEMO_RESTAURANT_NAME} limit 1`;
    } finally {
      await sql.end();
    }
    try {
      await page.goto('/dashboard');
      const card = page.getByTestId('needs-you');
      await expect(card).toBeVisible();
      const more = card.getByTestId('needs-you-more');
      await expect(more, 'four tasks: one waits behind "עוד"').toBeVisible();
      const hidden = more.locator('[data-needs-list="more"] > li[data-needs-row]');
      const count = await hidden.count();
      expect(count).toBeGreaterThan(0);
      test.info().annotations.push({ type: 'more', description: `${count} behind "עוד"` });
      // Its own ul[data-record] after the shown list (never nested in it); the preview is row data, beside the button.
      await expect(more.locator('ul[data-record][data-needs-list="more"]')).toHaveCount(1);
      const button = more.getByRole('button');
      await expect(button).toHaveText(interpolate(ovHe.needs.moreTasks, { count }, 'he-IL'));
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button).toHaveAttribute('data-focus', 'inset');
      await expect(button.locator('[data-record]'), 'the preview sits outside the button').toHaveCount(0);
      await expect(more.locator('span[data-record]'), 'the hidden rows named beside the button').toBeVisible();
      await expect(more.locator('[data-needs-list="more"]').locator('xpath=..')).toHaveAttribute('inert', '');

      const first = await hidden.first().getAttribute('data-needs-row');
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(more).toHaveAttribute('data-open', 'true');
      const firstRow = card.getByTestId(`needs-${first}`);
      await expect(firstRow, 'focus on the first revealed row').toBeFocused();
      await expect(more.locator('span[data-record]'), 'no preview once open').toBeHidden();
      // The revealed rows sit ABOVE the button (the reference's order), whole-row targets like the rest.
      await expect(firstRow).toBeVisible();
      await page.waitForTimeout(400); // the rows have finished growing (the medium duration)
      const rowBox = (await firstRow.boundingBox())!;
      const buttonBox = (await button.boundingBox())!;
      expect(rowBox.y + rowBox.height, 'the revealed row above the button').toBeLessThanOrEqual(buttonBox.y + 1);
      expect(rowBox.height, 'a whole-row target').toBeGreaterThanOrEqual(48);
      await expect(firstRow).toHaveAttribute('data-focus', 'inset');

      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(button, 'closing leaves focus on the button').toBeFocused();
    } finally {
      const clean = e2eSql();
      await clean`delete from invoices where invoice_number = ${NUMBER}`.finally(() => clean.end());
    }
  });

  test('"הוחזר החודש": the round tick, the amount in the recovered role, its basis', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('needs-you')).toBeVisible();
    const flags = await trpc<{ recovery: boolean }>(page, 'recovery.flags');
    test.skip(!flags.recovery, 'recovery is off for the demo restaurant: no good-news card');
    const sql = e2eSql();
    let fixture: { id: string; status: string; credited_agorot: string; credited_at: Date | null; recovered_at: Date | null } | undefined;
    try {
      let { returnedAgorot } = await trpc<{ returnedAgorot: number | null }>(page, 'recovery.returnedThisMonth');
      if (returnedAgorot == null || returnedAgorot <= 0) {
        // Nothing back yet is no card — never "₪0".
        await expect(page.getByTestId('hero-returned')).toHaveCount(0);
        // The seed recovers nothing: one claim recovered today for this check (W1-08's pattern), put back after.
        [fixture] = await sql<NonNullable<typeof fixture>[]>`
          select c.id, c.status, c.credited_agorot, c.credited_at, c.recovered_at from recovery_claims c
          join restaurants r on r.id = c.restaurant_id
          where r.name = ${DEMO_RESTAURANT_NAME} and c.status = 'claimed' order by c.amount_agorot desc limit 1`;
        test.skip(!fixture, 'the seed has no claim to recover');
        await sql`update recovery_claims set status = 'recovered', credited_agorot = amount_agorot, credited_at = now(), recovered_at = now() where id = ${fixture!.id}`;
        ({ returnedAgorot } = await trpc<{ returnedAgorot: number | null }>(page, 'recovery.returnedThisMonth'));
        expect(returnedAgorot, 'the fixture is recovered this month').toBeGreaterThan(0);
        test.info().annotations.push({ type: 'fixture', description: `the seed recovered nothing this month: claim ${fixture!.id} recovered for this check, put back after` });
        await page.goto('/dashboard');
      }
      const card = page.getByTestId('hero-returned');
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('href', '/dashboard/recovery');
      await expect(card).toContainText(ovHe.hero.returned);
      await expect(card).toContainText(leaksHe.claims.basis.excl);
      const figure = card.locator('[data-money-figure]');
      expect(num(await figure.innerText()), 'the returned figure').toBe(Math.round(returnedAgorot! / 100));
      // T3: the amount in the recovered role (leaf green), beside the round tick on the ok dot.
      expect(await figure.evaluate((el) => getComputedStyle(el).color)).toBe(await roleColour(page, 'text-gold', 'color'));
      const tick = card.locator('span[aria-hidden="true"]').first();
      const look = await tick.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, round: Number.parseFloat(s.borderTopLeftRadius) >= el.getBoundingClientRect().height / 2 - 0.5 };
      });
      expect(look.bg).toBe(await roleColour(page, 'bg-ok-dot', 'backgroundColor'));
      expect(look.round, 'the tick is round').toBe(true);
    } finally {
      if (fixture) {
        await sql`update recovery_claims set status = ${fixture.status}, credited_agorot = ${fixture.credited_agorot}, credited_at = ${fixture.credited_at}, recovered_at = ${fixture.recovered_at} where id = ${fixture.id}`;
      }
      await sql.end();
    }
  });

  test('numbers in the first fold: ceilings per zone, within the IA-01 ratchet, one filled primary', async ({ page }) => {
    const { state } = await openHome(page);
    await expect(page.getByTestId('needs-you')).toBeVisible();
    await settle(page);
    const all = await measureWithHidden(page, []);
    const hero = await zoneNumbers(page, '[data-testid="leak-hero"]');
    const context = await zoneNumbers(page, '[data-testid="page-context"]');
    // The task card outside its row data: both lists and the preview of the rows behind "עוד" are [data-record] (v4 H4, T7).
    const needsOutsideRows = await zoneNumbers(page, '[data-testid="needs-you"]', ['[data-testid="needs-you"] [data-record]']);
    const returned = await zoneNumbers(page, '[data-testid="hero-returned"]');
    const zones = `hero ${hero} · page-context ${context} · needs outside rows ${needsOutsideRows} · returned ${returned} · total ${all.numbers} · primary ${all.primary}`;
    test.info().annotations.push({ type: 'numbers', description: `owner desk (${state}): ${zones}` });
    expect(hero, `hero (${state}) — ${zones}`).toBeLessThanOrEqual(HERO_CEILING[state]);
    expect(context, zones).toBeLessThanOrEqual(1);
    expect(needsOutsideRows, zones).toBeLessThanOrEqual(1);
    expect(returned, zones).toBeLessThanOrEqual(1);
    expect(all.numbers, `IA-01 ratchet home-owner-desk — ${zones}`).toBeLessThanOrEqual(BASELINE_0711['home-owner-desk']!.numbers!);
    const hasRows = (await page.locator('[data-testid="needs-you"] [data-needs-row]').count()) > 0;
    if (hasRows) expect(all.primary, `one filled primary at 1440×900 — ${zones}`).toBe(1);
    else expect(all.primary, zones).toBeLessThanOrEqual(1);
  });
});

/* ─────────────────────────────── owner · phone ─────────────────────────────── */

test.describe('owner · phone 390×844', () => {
  test.use({ storageState: OWNER_STATE, ...PHONE });
  test.beforeEach(async ({ context, baseURL }) => cookies(context, baseURL!, 'he'));

  test('the hero ₪ in the fold, 44 px targets, the reading order, the numbers', async ({ page }) => {
    const { hero, state } = await openHome(page);
    await expect(page.getByTestId('needs-you')).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a touch phone (coarse pointer)').toBe(true);
    await settle(page);

    const amount = (await page.getByTestId('leak-hero-amount').boundingBox())!;
    expect(amount.y + amount.height, 'the hero ₪ above the bottom nav').toBeLessThanOrEqual(await foldBottom(page));
    if (state === 'leak') await expect(hero.getByTestId('leak-hero-completeness'), 'completeness on the phone too').toBeVisible();

    // Every link and button of the leak card and the task card: ≥44×44 on a coarse pointer (SPEC §5).
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="leak-hero"] :is(a[href], button, summary), [data-testid="needs-you"] :is(a[href], button)')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]') && (r.width < 44 || r.height < 44);
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${Math.round(r.width)}×${Math.round(r.height)} ${el.outerHTML.slice(0, 100)}`;
        }),
    );
    expect(small, 'targets under 44×44').toEqual([]);

    // One column, in this order in the page and on screen: the leak card, the tasks, the question line, the good news.
    const order = await page.evaluate(() =>
      ['leak-hero', 'needs-you', 'home-link-questions', 'hero-returned']
        .map((id) => document.querySelector(`[data-testid="${id}"]`))
        .filter((el): el is Element => el !== null)
        .map((el, i, list) => ({
          id: el.getAttribute('data-testid'),
          top: el.getBoundingClientRect().top + window.scrollY,
          domAfterPrevious: i === 0 || Boolean(list[i - 1]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
        })),
    );
    expect(order.length).toBeGreaterThanOrEqual(2);
    for (const [i, block] of order.entries()) {
      expect(block.domAfterPrevious, `${block.id} follows in the page`).toBe(true);
      if (i > 0) expect(block.top, `${block.id} below ${order[i - 1]!.id}`).toBeGreaterThan(order[i - 1]!.top);
    }

    const all = await measureWithHidden(page, []);
    const heroNumbers = await zoneNumbers(page, '[data-testid="leak-hero"]');
    const context = await zoneNumbers(page, '[data-testid="page-context"]');
    const zones = `hero ${heroNumbers} · page-context ${context} · total ${all.numbers} · primary ${all.primary}`;
    test.info().annotations.push({ type: 'numbers', description: `owner phone (${state}): ${zones}` });
    expect(heroNumbers, `hero (${state}) — ${zones}`).toBeLessThanOrEqual(HERO_CEILING[state]);
    expect(context, zones).toBeLessThanOrEqual(1);
    expect(all.numbers, `IA-01 ratchet home-owner-phone — ${zones}`).toBeLessThanOrEqual(BASELINE_0711['home-owner-phone']!.numbers!);
    expect(all.primary, `at most one filled primary in the phone fold — ${zones}`).toBeLessThanOrEqual(1);
  });
});

/* ─────────────────────────────── owner · motion ─────────────────────────────── */

test.describe('owner · reduced motion', () => {
  test.use({ storageState: OWNER_STATE, viewport: DESK, contextOptions: { reducedMotion: 'reduce' } });
  test.beforeEach(async ({ context, baseURL }) => cookies(context, baseURL!, 'he'));

  test('reduce: nothing in the leak card runs and the number shows its final figure at once', async ({ page }) => {
    const { hero, state } = await openHome(page);
    const figures = await trpc<HeroFigures>(page, 'owner.leakHero');
    const amount = page.getByTestId('leak-hero-amount');
    // At once: no hold (opaque), the procedure's figure, no count overlay.
    const now = await amount.evaluate((el) => ({
      opacity: getComputedStyle(el.querySelector('[data-entry-part="count"]') ?? el).opacity,
      text: el.textContent ?? '',
    }));
    expect(now.opacity, 'the number is not held').toBe('1');
    if (state === 'leak' || state === 'clean') expect(num(now.text), 'the final figure at once').toBe(Math.round(figures.leakIls));
    await expect(page.locator('[data-hero-count]')).toHaveCount(0);
    expect(await runningHeroAnimations(page)).toEqual([]);
    // The island ends the entry before paint.
    await expect(hero).not.toHaveAttribute('data-entry');
    await page.waitForTimeout(600);
    expect(await runningHeroAnimations(page), 'still nothing, half a second later').toEqual([]);
    await expect(page.locator('[data-hero-count]')).toHaveCount(0);
  });
});

interface EntryRecord {
  inserted: number[];
  removed: number[];
  texts: string[];
  overlayInside: boolean;
  overlays: { hidden: boolean; events: string }[];
}

test.describe('owner · entry motion', () => {
  test.use({ storageState: OWNER_STATE, viewport: DESK, contextOptions: { reducedMotion: 'no-preference' } });
  test.beforeEach(async ({ context, baseURL }) => cookies(context, baseURL!, 'he'));

  test('no preference: data-entry on load, removed after the entry, the number never rewritten; a client Back replays nothing', async ({ page }) => {
    // Before any page script: record when the card arrives with data-entry and when it loses it, every
    // frame's text of the testid element (complete figures only, with the ₪), and where a count overlay sits.
    await page.addInitScript(() => {
      const rec: EntryRecord = { inserted: [], removed: [], texts: [], overlayInside: false, overlays: [] };
      (window as unknown as { __ds3Entry: EntryRecord }).__ds3Entry = rec;
      const HERO = 'section[data-testid="leak-hero"]';
      new MutationObserver((records) => {
        const at = performance.now();
        // A card inserted and stripped of data-entry in one commit (a remount) arrived with it all the same.
        const strippedNow = new Set<Node>();
        for (const r of records) {
          const el = r.target as Element;
          if (r.type === 'attributes' && el.matches(HERO) && r.oldValue !== null && !el.hasAttribute('data-entry')) {
            rec.removed.push(at);
            strippedNow.add(el);
          }
        }
        for (const r of records) {
          for (const node of r.addedNodes) {
            if (!(node instanceof Element)) continue;
            const hero = node.matches(HERO) ? node : node.querySelector(HERO);
            if (hero && (hero.hasAttribute('data-entry') || strippedNow.has(hero))) rec.inserted.push(at);
          }
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-entry'], attributeOldValue: true });
      const until = performance.now() + 8000;
      const frame = () => {
        const amount = document.querySelector('[data-testid="leak-hero-amount"]');
        if (amount) {
          const text = (amount.textContent ?? '').replace(/[‎‏⁦-⁩\s]/g, '');
          if (text.includes('₪') && !rec.texts.includes(text)) rec.texts.push(text);
          if (amount.querySelector('[data-hero-count]')) rec.overlayInside = true;
        }
        const overlay = document.querySelector('[data-hero-count]');
        if (overlay && rec.overlays.length < 50) rec.overlays.push({ hidden: overlay.getAttribute('aria-hidden') === 'true', events: getComputedStyle(overlay).pointerEvents });
        if (performance.now() < until) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    const { hero, state } = await openHome(page);
    test.skip(state !== 'leak', `the entry plays for a leak month only (seed day: ${state})`);
    const figures = await trpc<HeroFigures>(page, 'owner.leakHero');
    const record = () => page.evaluate(() => (window as unknown as { __ds3Entry: EntryRecord }).__ds3Entry);

    // The entry ends by itself: the island removes data-entry once the hold (and any late pace part) has finished.
    await expect(hero).not.toHaveAttribute('data-entry', { timeout: 20_000 });
    await expect(page.locator('[data-hero-count]')).toHaveCount(0);
    const first = await record();
    expect(first.inserted.length, 'the card arrived with data-entry').toBeGreaterThan(0);
    expect(first.removed.length, 'the island ended the entry').toBeGreaterThan(0);
    const durLong = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-long')));
    expect(durLong, '--dur-long resolves').toBeGreaterThan(0);
    expect(first.removed.at(-1)! - first.inserted[0]!, 'data-entry lasts at least the long duration').toBeGreaterThanOrEqual(durLong - 50);
    // The testid element only ever said the final figure; the count (if it ran) was a hidden, inert sibling.
    const final = (await page.getByTestId('leak-hero-amount').textContent())!.replace(/[‎‏⁦-⁩\s]/g, '');
    expect(num(final)).toBe(Math.round(figures.leakIls));
    expect(first.texts, 'every frame showed the final figure').toEqual([final]);
    expect(first.overlayInside, 'the count overlay is never inside the testid element').toBe(false);
    for (const o of first.overlays) expect(o, 'the count overlay is aria-hidden and lets clicks through').toEqual({ hidden: true, events: 'none' });
    test.info().annotations.push({ type: 'entry', description: `data-entry for ${Math.round(first.removed.at(-1)! - first.inserted[0]!)} ms · count overlay seen in ${first.overlays.length} frames` });

    // A client navigation away and Back: the router restores the page, the island removes data-entry before paint.
    await page.evaluate(() => {
      (window as unknown as { __ds3SameDocument: boolean }).__ds3SameDocument = true;
    });
    const before = first.inserted.length;
    await page.locator('aside a[href="/dashboard/leaks"], nav a[href="/dashboard/leaks"]').first().click();
    await page.waitForURL(/\/dashboard\/leaks(\?|#|$)/);
    await expect(page.locator('main')).toBeVisible();
    await page.goBack();
    await page.waitForURL(/\/dashboard(\?|#|$)/);
    await expect(page.getByTestId('leak-hero')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __ds3SameDocument?: boolean }).__ds3SameDocument === true), 'Back stayed in the document').toBe(true);
    expect(await runningHeroAnimations(page), 'no rm-hero-* on Back').toEqual([]);
    await expect(page.locator('[data-hero-count]')).toHaveCount(0);
    await expect(page.getByTestId('leak-hero')).not.toHaveAttribute('data-entry');
    const back = await record();
    test.info().annotations.push({ type: 'back', description: back.inserted.length > before ? `data-entry restored, removed after ${Math.round(back.removed.at(-1)! - back.inserted.at(-1)!)} ms` : 'the card came back without data-entry' });
    if (back.inserted.length > before) {
      // The card came back with data-entry in the restored payload: gone in the commit that inserted it (before paint).
      expect(back.removed.at(-1)! - back.inserted.at(-1)!, 'removed in the same commit').toBeLessThan(50);
    }
    await page.waitForTimeout(500);
    expect(await runningHeroAnimations(page), 'still nothing half a second later').toEqual([]);
    await expect(page.locator('[data-hero-count]')).toHaveCount(0);
    expect(
      await page.getByTestId('leak-hero-amount').evaluate((el) => getComputedStyle(el.querySelector('[data-entry-part="count"]') ?? el).opacity),
      'the number shows (no hold on Back)',
    ).toBe('1');
  });
});

/* ─────────────────────────────── owner · English ─────────────────────────────── */

test.describe('owner · English', () => {
  test.use({ storageState: OWNER_STATE, viewport: DESK });
  test.beforeEach(async ({ context, baseURL }) => cookies(context, baseURL!, 'en'));

  test('English once: no Hebrew left in the leak card — its text, its names, its titles (the calculation open)', async ({ page }) => {
    const { hero, state } = await openHome(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(hero.locator('#leak-hero-label')).toHaveText(ovEn.hero.leakedLabel);
    if (state === 'leak') {
      await settle(page);
      await hero.getByTestId('hero-why-toggle').click();
      await expect(hero.getByTestId('hero-calc')).toBeVisible({ timeout: 30_000 });
      await expect(hero.getByTestId('hero-why-toggle')).toHaveText(ovEn.needs.why);
    }
    const leftovers = await hero.evaluate((el, source) => {
      const re = new RegExp(source);
      const out = (el as HTMLElement).innerText
        .split('\n')
        .filter((line) => re.test(line))
        .map((line) => `text: ${line}`);
      for (const node of [el, ...el.querySelectorAll('*')]) {
        for (const attr of ['aria-label', 'title']) {
          const v = node.getAttribute(attr);
          if (v && re.test(v)) out.push(`${attr}: ${v}`);
        }
      }
      return out;
    }, HEBREW.source);
    expect(leftovers).toEqual([]);
  });
});

/* ─────────────────────────────── manager · bookkeeper ─────────────────────────────── */

/** One password sign-in per role per run, reused as storage state (the W2-08 pattern). */
const states = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

async function asRole(browser: Browser, role: string, opts: Parameters<Browser['newContext']>[0], baseURL: string) {
  const saved = states.get(role);
  const context = await browser.newContext({ ...opts, baseURL, ...(saved ? { storageState: saved } : {}) });
  await cookies(context, baseURL, 'he');
  const page = await context.newPage();
  if (!saved) {
    const csrf = (await (await page.request.get('/api/auth/csrf')).json()) as { csrfToken: string };
    const res = await page.request.post('/api/auth/callback/credentials', {
      form: { email: `${role}@kfar-hazeitim.test`, password: PASSWORD, rememberMe: 'false', csrfToken: csrf.csrfToken, callbackUrl: '/dashboard' },
      maxRedirects: 0,
    });
    expect(res.status(), `${role} sign-in`).toBeLessThan(400);
    expect((await context.cookies()).some((c) => /session-token/.test(c.name)), `${role} session cookie`).toBe(true);
    states.set(role, await context.storageState());
  }
  return { context, page };
}

test.describe('manager and bookkeeper: their lens unchanged', () => {
  for (const role of ['manager', 'bookkeeper'] as const) {
    test(`${role}: no leak card, the context line hidden, the task card contract, numbers within the ratchet`, async ({ browser, baseURL }) => {
      for (const [vp, opts] of [
        ['desk', { viewport: DESK }],
        ['phone', PHONE],
      ] as const) {
        const { context, page } = await asRole(browser, role, opts, baseURL!);
        try {
          await page.goto('/dashboard');
          await expect(page.locator(`[data-home="${role}"]`)).toBeVisible();
          const card = page.getByTestId('needs-you');
          await expect(card).toBeVisible();
          await expect(page.getByTestId('leak-hero')).toHaveCount(0);
          await expect(page.getByTestId('page-context'), 'the context line stays hidden (their lens)').toBeHidden();
          if (role === 'manager') {
            // The leak as one link row under the tasks: the same figure as the owner's hero, to the agora.
            const figures = await trpc<HeroFigures>(page, 'owner.leakHero');
            const link = page.getByTestId('home-leak-link');
            await expect(link).toBeVisible();
            await expect(link.locator('[data-money-agorot]')).toHaveAttribute('data-money-agorot', String(agorotOf(figures.leakIls)));
          } else {
            await expect(page.getByTestId('home-leak-link')).toHaveCount(0);
          }
          const rows = card.locator('[data-needs-list="shown"] > li[data-needs-row] > a');
          const hasRows = (await rows.count()) > 0;
          for (const row of await rows.all()) await expect(row).toHaveAttribute('data-focus', 'inset');
          expect(
            await card.evaluate((el) => [...el.querySelectorAll('li[data-needs-row]')].filter((li) => !li.parentElement?.matches('ul[data-record]')).length),
            'rows sit in ul[data-record] lists',
          ).toBe(0);
          await settle(page);
          const counts = await measureWithHidden(page, []);
          const allowance = BASELINE_0711[`home-${role}-${vp}`]!.numbers!;
          test.info().annotations.push({ type: 'numbers', description: `${role} ${vp}: total ${counts.numbers} (ratchet ${allowance}) · primary ${counts.primary}` });
          expect(counts.numbers, `IA-01 ratchet home-${role}-${vp}`).toBeLessThanOrEqual(allowance);
          if (vp === 'desk' && hasRows) expect(counts.primary, 'one filled primary at 1440×900').toBe(1);
          else expect(counts.primary).toBeLessThanOrEqual(1);
        } finally {
          await context.close();
        }
      }
    });
  }
});
