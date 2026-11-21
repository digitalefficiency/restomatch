import { PassThrough } from 'node:stream';
import * as React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';
import { overview } from '@/lib/i18n/messages/overview';
import { views } from '@/lib/i18n/messages/views';
import { leaks } from '@/lib/i18n/messages/leaks';
import { recovery } from '@/lib/i18n/messages/recovery';
import { leakProof } from '@/lib/i18n/messages/leakProof';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { Caller } from '../caller';

/**
 * DS3-03 · the finance homes as the server renders them (SPEC §10.1): the leak card wired from
 * the procedures' figures (owner.leakHero + leakSummary previous + leakTrend), "מחכה לך" from
 * tasks.mine, "הוחזר החודש" from recovery.returnedThisMonth. The loaders, the tRPC client hook (the
 * calculation rows load on the first open, in the browser) and the router are stubbed; everything
 * else is the real tree. Fixtures are the lab's figures of 21.11.
 */

const lab = vi.hoisted(() => {
  const current = {
    monthStart: '2026-10-31T22:00:00.000Z',
    monthEnd: '2026-11-30T22:00:00.000Z',
    leakIls: 769.77,
    spendIls: 41525.86,
    leakPct: 769.77 / 41525.86,
    caughtBeforePaymentIls: 308.66,
    recoveredIls: 0,
    invoiceCount: 40,
    matchedInvoiceCount: 34,
    invoicesWithLeak: 13,
    pendingLinkCount: 2,
    pendingLinkIls: 3910.12,
    awaitingCountCount: 0,
    awaitingCountIls: 0,
    awaitingQuestionCount: 0,
    awaitingQuestionIls: 0,
  };
  const previous = { ...current, monthStart: '2026-09-30T21:00:00.000Z', monthEnd: '2026-10-21T21:00:00.000Z', leakIls: 617.89, invoiceCount: 30, matchedInvoiceCount: 28 };
  return {
    current,
    previous,
    hero: { current, previous } as { current: typeof current; previous: typeof previous | null },
    flags: { recovery: true, monthlyReport: true, monthlyDigestPreview: false, leakProof: true },
    trend: {
      bucket: 'day' as const,
      points: [
        { bucketStart: '2026-11-01T22:00:00.000Z', leakIls: 400, spendIls: 0 },
        { bucketStart: '2026-11-10T22:00:00.000Z', leakIls: 369.77, spendIls: 0 },
      ],
      previous: [{ bucketStart: '2026-10-04T21:00:00.000Z', leakIls: 617.89, spendIls: 0 }],
    },
  };
});

vi.mock('../data', () => ({
  loadHeroPair: vi.fn(async () => lab.hero),
  loadRecoveryFlags: vi.fn(async () => lab.flags),
  loadTrend: vi.fn(async () => lab.trend),
}));
// The rows of "איך הגענו לסכום?" are read in the browser on the first open; closed, nothing is asked.
const leakReportQuery = vi.hoisted(() => vi.fn(() => ({ data: undefined, isError: false, isFetching: false, refetch: async () => undefined })));
vi.mock('@/lib/trpc/client', () => ({ trpc: { owner: { leakReport: { useQuery: leakReportQuery } } } }));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<object>()), useRouter: () => ({ refresh: () => undefined }) }));

(globalThis as unknown as { React?: unknown }).React = React;
const { FinanceHome } = await import('../finance');

type Role = 'owner' | 'manager' | 'bookkeeper';

const task = (p: Record<string, unknown>) => ({
  type: 'decision',
  entityId: 'decision:mine',
  title: 'decision',
  ilsAgorot: 29_600,
  count: 5,
  blocking: 2,
  tier: 'T2',
  tone: 'danger',
  due: null,
  ageDays: 3,
  verb: 'decide',
  deepLink: '/dashboard/approvals',
  scope: 'mine',
  detail: { toReview: 1, duplicateAgorot: 0, vatAgorot: 0 },
  ...p,
});

const TASKS = [
  task({}),
  task({ type: 'claim_to_send', entityId: 'claims:unsent', ilsAgorot: 47_899, count: 10, blocking: 0, tone: 'warn', deepLink: '/dashboard/recovery', detail: {} }),
  task({ type: 'payment_due', entityId: 'payrun:month', ilsAgorot: 929_646, count: 10, blocking: 0, tone: 'neutral', deepLink: '/dashboard/approvals/pay-run', detail: {} }),
  task({ type: 'doc_review', entityId: 'docs:lines', ilsAgorot: null, count: 2, blocking: 0, tone: 'warn', deepLink: '/dashboard/invoices', detail: {} }),
];

/** A caller that answers the home's two direct reads and records every call (anything else throws). */
function callerFor(calls: string[]): Caller {
  const answers: Record<string, unknown> = {
    'tasks.mine': { tasks: TASKS, failed: [], restaurantClear: false },
    'recovery.returnedThisMonth': { monthStart: lab.current.monthStart, monthEnd: lab.current.monthEnd, returnedAgorot: 123_528, claimCount: 3 },
  };
  const ns = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, proc) =>
          typeof proc === 'string'
            ? async () => {
                const path = `${name}.${proc}`;
                calls.push(path);
                if (!(path in answers)) throw new Error(`unexpected procedure ${path}`);
                return answers[path];
              }
            : undefined,
      },
    );
  return new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' && prop !== 'then' ? ns(prop) : undefined) }) as unknown as Caller;
}

function render(node: React.ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    const { pipe } = renderToPipeableStream(node, {
      onAllReady() {
        const out = new PassThrough();
        let html = '';
        out.on('data', (c) => (html += c));
        out.on('end', () => resolve(html));
        pipe(out);
      },
      onShellError: reject,
      onError: (e) => reject(e),
    });
  });
}

async function home(role: Role, locale: Locale = 'he', calls: string[] = []): Promise<string> {
  return render(
    (React.createElement as (...a: unknown[]) => React.ReactElement)(FinanceHome, {
      caller: callerFor(calls),
      role,
      restaurantId: 'r1',
      restaurantName: 'כפר הזיתים',
      locale,
      view: {},
      fail: new Set<string>(),
      t: createTranslator(locale, overview),
      tv: createTranslator(locale, views),
      tl: createTranslator(locale, leaks),
      tr: createTranslator(locale, recovery),
      tp: createTranslator(locale, leakProof),
      ta: createTranslator(locale, approvals),
    }),
  );
}

/** The markup of the element with this test id (its opening tag through the matching close, best effort). */
const tagOf = (html: string, id: string) => html.match(new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? '';
const textOf = (fragment: string) => fragment.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
/** From the element with this test id to the end of its first closing tag of the same name. */
function blockOf(html: string, id: string): string {
  const open = html.match(new RegExp(`<([a-z]+)[^>]*data-testid="${id}"[^>]*>`));
  if (!open || open.index === undefined) return '';
  const tag = open[1]!;
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = open.index;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open.index, m.index + m[0].length);
  }
  return html.slice(open.index);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T10:00:00.000Z'));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  lab.hero = { current: lab.current, previous: lab.previous };
  lab.flags = { recovery: true, monthlyReport: true, monthlyDigestPreview: false, leakProof: true };
});

describe('owner home, a leak month (the lab, 21.11)', () => {
  it('one column of blocks in the order of the phone: the leak card, "מחכה לך", "הוחזר החודש"', async () => {
    const calls: string[] = [];
    const html = await home('owner', 'he', calls);
    const at = (id: string) => html.indexOf(`data-testid="${id}"`);
    expect(at('leak-hero')).toBeGreaterThan(-1);
    expect(at('leak-hero')).toBeLessThan(at('needs-you'));
    expect(at('needs-you')).toBeLessThan(at('hero-returned'));
    expect(html).toMatch(/data-home-blocks="owner"/);
    expect(calls.sort()).toEqual(['recovery.returnedThisMonth', 'tasks.mine']);
    // Closed, the calculation asks for nothing yet.
    const asked = leakReportQuery.mock.calls as unknown as Array<[unknown, { enabled: boolean }]>;
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every(([, options]) => options.enabled === false)).toBe(true);
  });

  it('the label, its period outside the h2, the exact figure with its G-16 markers, the entry once', async () => {
    const hero = blockOf(await home('owner'), 'leak-hero');
    expect(tagOf(hero, 'leak-hero')).toMatch(/data-state="leak"/);
    expect(tagOf(hero, 'leak-hero')).toMatch(/data-entry=""/);
    expect(hero).toContain('<style>');
    expect(hero).toMatch(/<h2 id="leak-hero-label"[^>]*>דליפה החודש<\/h2>/);
    expect(textOf(blockOf(hero, 'leak-hero-period'))).toBe('מתחילת נובמבר');
    const amount = tagOf(hero, 'leak-hero-amount');
    expect(amount).toMatch(/data-money-agorot="76977"/);
    expect(amount).toMatch(/data-money-sum-of="hero-split"/);
    expect(amount).toMatch(/href="\/dashboard\/leaks\/breakdown"/);
    // No filled primary on the card: the one primary of the screen is "מחכה לך"'s first verb.
    expect(hero).not.toContain('data-primary');
  });

  it('the scale sentence and the change in words: the % unsigned, never a red money figure', async () => {
    const hero = blockOf(await home('owner'), 'leak-hero');
    const pct = textOf(blockOf(hero, 'leak-hero-pct'));
    expect(pct).toMatch(/^1\.9% מהרכש שנבדק, מתוך .*41,526.* לפני מע״מ$/);
    expect(textOf(blockOf(hero, 'leak-hero-base'))).toMatch(/^, מתוך .*41,526/);
    const delta = blockOf(hero, 'leak-hero-delta');
    expect(tagOf(delta, 'leak-hero-delta')).toMatch(/data-direction="up"/);
    // 769.77 − 617.89 = ₪151.88 → "₪152"; 15,188 / 61,789 = 25%.
    expect(textOf(delta)).toMatch(/^עלייה של .*152.* \(25%\) לעומת אותם ימים באוקטובר$/);
    expect(tagOf(delta, 'leak-hero-delta')).not.toMatch(/text-danger/);
  });

  it('the pace line: named in words, no figure of its own, the dashed line for the same days of October', async () => {
    const pace = blockOf(await home('owner'), 'leak-hero-pace');
    expect(pace).toMatch(/aria-label="הדליפה המצטברת מתחילת נובמבר, מול אותם ימים באוקטובר\. החודש מעל אוקטובר\."/);
    expect(textOf(pace)).toBe('נובמבראוקטובר, אותם ימים');
    expect(pace).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(pace).toContain('stroke-dasharray="2 3"');
  });

  it('the split: the bar, two figures that add up to the hero to the agora, and a link under each', async () => {
    const hero = blockOf(await home('owner'), 'leak-hero');
    expect(hero).toContain('data-split-bar=""');
    expect(hero).toMatch(/role="group" aria-label="הדליפה מתחלקת לשניים"/);
    const rows = [...hero.matchAll(/data-money-row-of="hero-split" data-money-agorot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(rows).toEqual([30866, 46111]);
    expect(rows[0]! + rows[1]!).toBe(76977);
    expect(tagOf(hero, 'hero-unpaid-link')).toMatch(/href="\/dashboard\/leaks\/breakdown#group-unpaid"/);
    expect(textOf(blockOf(hero, 'hero-unpaid-link'))).toBe('לחשבוניות שלא שולמו');
    expect(tagOf(hero, 'hero-paid-link')).toMatch(/href="\/dashboard\/leaks\/claims"/);
    expect(textOf(blockOf(hero, 'hero-paid-link'))).toBe('לבקשות הזיכוי');
  });

  it('the foot: what was checked (plain text, ICU numbers) and "איך הגענו לסכום?" closed, in place', async () => {
    const hero = blockOf(await home('owner'), 'leak-hero');
    const line = blockOf(hero, 'leak-hero-completeness');
    expect(line.startsWith('<span')).toBe(true);
    expect(textOf(line)).toBe('34 חשבוניות נבדקו, ב־13 מהן נמצא פער');
    expect(tagOf(hero, 'hero-why')).toMatch(/data-open="false"/);
    expect(tagOf(hero, 'hero-why-toggle')).toMatch(/aria-expanded="false"/);
    expect(textOf(blockOf(hero, 'hero-why-toggle'))).toBe('איך הגענו לסכום?');
    expect(hero).toMatch(/role="region" aria-label="החישוב של הדליפה, שורה אחרי שורה"/);
  });

  it('the calculation panel (closed): the rule, "לא נספרים:" as a list, what waits (incl. VAT), the full breakdown', async () => {
    const hero = blockOf(await home('owner'), 'leak-hero');
    // The rows are not on the page until the first open.
    expect(hero).not.toContain('data-testid="hero-calc"');
    expect(hero).not.toContain('data-money-row-of="hero-calc"');
    expect(textOf(blockOf(hero, 'hero-calc-rule'))).toContain('נספרים פערים ברמת אזהרה וחסימה, עד סכום כל חשבונית.');
    const excluded = [...blockOf(hero, 'hero-calc-excluded').matchAll(/<li>([^<]*)<\/li>/g)].map((m) => textOf(m[1]!));
    expect(excluded).toEqual(['מחיר נמוך מהמצופה', 'ממתינה לשיוך להזמנה', 'שורת הזמנה לא חויבה', 'חשבונית שסומנה "לא כפולה"']);
    expect(textOf(blockOf(hero, 'hero-pending-link'))).toMatch(/^2 חשבוניות ממתינות לשיוך להזמנה: .*3,910.* כולל מע״מ$/);
    expect(tagOf(hero, 'hero-proof')).toMatch(/href="\/dashboard\/leaks\/proof"/);
    expect(textOf(blockOf(hero, 'hero-proof'))).toBe('לפירוט המלא לפי חשבונית');
  });

  it('"מחכה לך": one card, the markup contract, ONE filled verb (row 0), the pill inside the sub line', async () => {
    const html = await home('owner');
    const needs = blockOf(html, 'needs-you');
    expect(html.match(/data-primary=""/g)).toHaveLength(1);
    expect(needs).toMatch(/<ul data-record=""[^>]*><li data-needs-row="decide" class="col-span-3 grid grid-cols-subgrid"><a [^>]*data-testid="needs-decide"/);
    const decide = tagOf(needs, 'needs-decide');
    expect(decide).toMatch(/data-focus="inset"/);
    expect(decide).toMatch(/data-primary-row=""/);
    expect(blockOf(needs, 'needs-decide')).toContain('data-primary=""');
    expect(blockOf(needs, 'needs-claimsUnsent')).not.toContain('data-primary');
    expect(textOf(blockOf(needs, 'needs-decide-sub'))).toBe('5 פערים · 1 לבדיקה (ללא ₪) · 2 חוסמים תשלום');
    expect(blockOf(needs, 'needs-decide-sub')).toMatch(/data-pill="solid"/);
  });

  it('"מחכה לך": mixed VAT bases → no chip, each amount states its basis (credit requests none yet)', async () => {
    const needs = blockOf(await home('owner'), 'needs-you');
    expect(needs).not.toContain('data-testid="needs-you-basis"');
    expect(textOf(blockOf(needs, 'needs-decide-basis'))).toBe('לפני מע״מ');
    expect(needs).not.toContain('data-testid="needs-claimsUnsent-basis"');
    expect(textOf(blockOf(needs, 'needs-payRun-basis'))).toBe('כולל מע״מ');
  });

  it('"עוד": a fold under the rows — its own list, a button with the ICU label, the preview outside it', async () => {
    const more = blockOf(await home('owner'), 'needs-you-more');
    expect(more).toMatch(/data-open="false"/);
    expect(more).toMatch(/<ul data-record=""[^>]*><li data-needs-row="invoiceLines"/);
    expect(more).toMatch(/<button type="button" aria-expanded="false" aria-controls="fold-[A-Za-z0-9_-]+" data-focus="inset"/);
    expect(more).toMatch(/>עוד משימה אחת<svg/);
    expect(more).toMatch(/<\/button><span data-record=""[^>]*>חשבוניות שממתינות לכם<\/span>/);
    // The rows come first in the page (they unfold above the button).
    expect(more.indexOf('data-needs-row="invoiceLines"')).toBeLessThan(more.indexOf('<button'));
  });

  it('"הוחזר החודש": the calm green card — the round tick, the amount in the recovered role, before VAT', async () => {
    const good = blockOf(await home('owner'), 'hero-returned');
    expect(tagOf(good, 'hero-returned')).toMatch(/href="\/dashboard\/recovery"/);
    expect(good).toContain('bg-ok-dot');
    expect(textOf(good)).toMatch(/^הוחזר החודשזיכויים שהתקבלו החודש, גם על חודשים קודמים.*1,235.*לפני מע״מ$/);
  });

  it('nothing back this month, or the recovery feature off: no card, never "₪0"', async () => {
    lab.flags = { ...lab.flags, recovery: false };
    expect(await home('owner')).not.toContain('data-testid="hero-returned"');
  });
});

describe('owner home, the other states of the card', () => {
  it('pendingOnly: "—" (unknown is not ₪0), what waits in place, no calculation, no entry', async () => {
    lab.hero = { current: { ...lab.current, leakIls: 0, matchedInvoiceCount: 0, invoicesWithLeak: 0, caughtBeforePaymentIls: 0, spendIls: 0, leakPct: null as unknown as number }, previous: null };
    const hero = blockOf(await home('owner'), 'leak-hero');
    expect(tagOf(hero, 'leak-hero')).toMatch(/data-state="pendingOnly"/);
    expect(tagOf(hero, 'leak-hero')).not.toMatch(/data-entry/);
    expect(textOf(blockOf(hero, 'leak-hero-amount'))).toBe('—');
    expect(textOf(blockOf(hero, 'leak-hero-pending'))).toMatch(/^2 חשבוניות ממתינות לשיוך להזמנה/);
    expect(hero).not.toContain('data-testid="hero-why"');
    expect(hero).not.toContain('₪0');
  });

  it('noData: "—", the month in the title, the secondary CTA, no period line', async () => {
    lab.hero = {
      current: { ...lab.current, leakIls: 0, matchedInvoiceCount: 0, invoicesWithLeak: 0, caughtBeforePaymentIls: 0, spendIls: 0, leakPct: null as unknown as number, pendingLinkCount: 0, pendingLinkIls: 0 },
      previous: null,
    };
    const hero = blockOf(await home('owner'), 'leak-hero');
    expect(tagOf(hero, 'leak-hero')).toMatch(/data-state="noData"/);
    expect(hero).toContain('עוד לא נבדקו חשבוניות בנובמבר');
    expect(hero).not.toContain('data-testid="leak-hero-period"');
    expect(tagOf(hero, 'hero-nodata-cta')).toMatch(/href="\/dashboard\/receiving"/);
  });

  it('clean: ₪0 muted, the green tick line, no split, no calculation, no foot line', async () => {
    lab.hero = { current: { ...lab.current, leakIls: 0, invoicesWithLeak: 0, caughtBeforePaymentIls: 0, leakPct: 0 }, previous: lab.previous };
    const hero = blockOf(await home('owner'), 'leak-hero');
    expect(tagOf(hero, 'leak-hero')).toMatch(/data-state="clean"/);
    expect(textOf(blockOf(hero, 'leak-hero-clean'))).toBe('אין דליפה · 34 חשבוניות נבדקו');
    expect(hero).not.toContain('data-testid="hero-unpaid"');
    expect(hero).not.toContain('data-testid="hero-why"');
    expect(hero).not.toContain('data-testid="leak-hero-completeness"');
    expect(hero).toMatch(/data-direction="down"/);
  });

  it('nothing marked paid (every real restaurant today): one honest line, no bar, no sum markers', async () => {
    lab.hero = { current: { ...lab.current, caughtBeforePaymentIls: lab.current.leakIls }, previous: lab.previous };
    const hero = blockOf(await home('owner'), 'leak-hero');
    expect(hero).not.toContain('data-split-bar=""');
    expect(tagOf(hero, 'leak-hero-amount')).not.toMatch(/data-money-sum-of/);
    const single = blockOf(hero, 'hero-split-single');
    expect(textOf(single)).toBe('כל הסכום על חשבוניות שלא סומנו כשולמולחשבוניות שלא סומנו כשולמו');
    expect(tagOf(single, 'hero-unpaid-link')).toMatch(/href="\/dashboard\/leaks\/breakdown#group-unpaid"/);
  });

  it('English: the card speaks English throughout', async () => {
    const hero = blockOf(await home('owner', 'en'), 'leak-hero');
    expect(textOf(hero).replace(/<style>[\s\S]*?<\/style>/, '')).not.toMatch(/[א-ת]/);
    expect(textOf(blockOf(hero, 'leak-hero-completeness'))).toBe('34 invoices checked, 13 with a gap');
    expect(textOf(blockOf(hero, 'leak-hero-period'))).toBe('Since the start of November');
  });
});

describe('the manager and the bookkeeper keep their own lens', () => {
  it('manager: tasks, then the leak as one link row with the hero’s exact figure; no leak card', async () => {
    const html = await home('manager');
    expect(html).not.toContain('data-testid="leak-hero"');
    expect(tagOf(html, 'home-leak-link')).toMatch(/href="\/dashboard\/leaks"/);
    expect(blockOf(html, 'home-leak-link')).toMatch(/data-money-agorot="76977"/);
    // Their title is for screen readers at the desk, so the basis is said on the row, never in a chip.
    expect(html).toContain('[&amp;_[data-needs-head]]:lg:sr-only');
    expect(html).not.toContain('data-testid="needs-you-basis"');
    expect(textOf(blockOf(html, 'needs-decide-basis'))).toBe('לפני מע״מ');
  });

  it('bookkeeper: her tasks only — no leak card, no leak row', async () => {
    const html = await home('bookkeeper');
    expect(html).not.toContain('data-testid="leak-hero"');
    expect(html).not.toContain('data-testid="home-leak-link"');
    expect(html).toContain('data-testid="needs-you"');
  });
});
