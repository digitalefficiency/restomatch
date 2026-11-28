// DS3-03 · the rows of "איך הגענו לסכום?" (SPEC §10.1; v2 A2–A8, v4 H3, H10), rendered in each state.
import '../../../../lib/components/__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Query = { data?: unknown; isError: boolean; isFetching: boolean; refetch: () => Promise<unknown> };
const query = vi.hoisted(() => ({ result: { data: undefined, isError: false, isFetching: false, refetch: async () => undefined } as Query, calls: [] as unknown[][] }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { owner: { leakReport: { useQuery: (...args: unknown[]) => (query.calls.push(args), query.result) } } },
}));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<object>()), useRouter: () => ({ refresh: () => undefined }) }));

const { CalcRows } = await import('../calc-rows');
const { HeroFold } = await import('@/lib/components/hero/HeroFold');

const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;

const MONTH_START = '2026-10-31T22:00:00.000Z';
const BASIS_BY_TYPE = { PRICE_HIGHER: 'excl', QTY_OVER: 'excl', UNORDERED_ITEM: 'excl', VAT_MISMATCH: 'vat', DUPLICATE_INVOICE: 'incl' };
const WORDS = { excl: 'לפני מע״מ', incl: 'כולל מע״מ', vat: 'סכום המע״מ', mixed: 'בסיס המע״מ מצוין ליד כל שורה.' };
const props = (over: Record<string, unknown> = {}) => ({ month: '2026-11', heroMonthStart: MONTH_START, heroAgorot: 76977, basisByType: BASIS_BY_TYPE, basisWords: WORDS, locale: 'he', ...over });
const html = (over?: Record<string, unknown>) => renderToStaticMarkup(h(CalcRows, props(over)));

/** owner.leakReport({month:'2026-11'}) on the lab, 21.11 (only the fields the panel reads, plus the rest of the hero). */
const LAB = {
  month: '2026-11',
  hero: { monthStart: MONTH_START, monthEnd: '2026-11-30T22:00:00.000Z', leakIls: 769.77, invoicesWithLeak: 13 },
  byType: [
    { type: 'PRICE_HIGHER', count: 7, amountIls: 400.82 },
    { type: 'QTY_OVER', count: 6, amountIls: 284.29 },
    { type: 'UNORDERED_ITEM', count: 1, amountIls: 72 },
    { type: 'VAT_MISMATCH', count: 1, amountIls: 12.66 },
  ],
  capAdjustmentIls: 0,
};
const ok = (data: unknown): Query => ({ data, isError: false, isFetching: false, refetch: async () => undefined });
const textOf = (fragment: string) => fragment.replace(/<[^>]+>/g, '');

beforeEach(() => {
  query.calls.length = 0;
  query.result = ok(undefined);
});

describe('the rows prove the hero: one grid, every amount in one column, G-16 markers', () => {
  it('the lab month: title, one row per kind of gap with its count and amount (2 dp), the total before rounding', () => {
    query.result = ok(LAB);
    const markup = html();
    expect(textOf(markup.match(/<h3[^>]*>.*?<\/h3>/)![0])).toBe('הסכום, שורה אחרי שורה: 15 פערים ב־13 חשבוניות');
    const rows = [...markup.matchAll(/data-testid="hero-calc-row" data-calc-type="(\w+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(['PRICE_HIGHER', 'QTY_OVER', 'UNORDERED_ITEM', 'VAT_MISMATCH']);
    expect(markup).toContain('מחיר גבוה מהמצופה');
    expect(markup).toContain('7 פערים');
    expect(markup).toContain('פער אחד');
    const agorot = [...markup.matchAll(/data-money-row-of="hero-calc" data-money-agorot="(\d+)"/g)].map((m) => Number(m[1]));
    expect(agorot).toEqual([40082, 28429, 7200, 1266]);
    expect(agorot.reduce((a, b) => a + b, 0)).toBe(76977);
    expect(markup).toMatch(/data-money-sum-of="hero-calc" data-money-agorot="76977"/);
    expect(markup).not.toContain('data-money-cap-agorot');
    expect(markup).toContain('סך הכול, לפני עיגול לשקל');
    expect(textOf(markup.slice(markup.indexOf('data-testid="hero-calc-total"')))).toMatch(/769\.77/);
    // The double rule over the total; the amounts right-aligned in their shared column.
    expect(markup).toMatch(/data-testid="hero-calc-total" class="[^"]*border-t-4 border-double border-fg/);
    expect(markup).toMatch(/class="text-right text-fg" data-money-row-of="hero-calc"/);
  });

  it('rows of more than one VAT basis say theirs, and the note says the rows carry it', () => {
    query.result = ok(LAB);
    const markup = html();
    expect(markup).toContain('7 פערים · לפני מע״מ');
    expect(markup).toContain('פער אחד · סכום המע״מ');
    expect(markup).toContain('בסיס המע״מ מצוין ליד כל שורה.');
  });

  it('one basis only: no captions, no note', () => {
    query.result = ok({ ...LAB, hero: { ...LAB.hero, leakIls: 757.11 }, byType: LAB.byType.slice(0, 3) });
    const markup = html({ heroAgorot: 75711 });
    expect(markup).not.toContain('· לפני מע״מ');
    expect(markup).not.toContain('בסיס המע״מ');
  });

  it('a capped month: the cap row in words (never a hand-built minus) and the cap marker on the total', () => {
    query.result = ok({
      ...LAB,
      hero: { ...LAB.hero, leakIls: 118, invoicesWithLeak: 1 },
      byType: [
        { type: 'DUPLICATE_INVOICE', count: 1, amountIls: 118 },
        { type: 'PRICE_HIGHER', count: 1, amountIls: 30 },
      ],
      capAdjustmentIls: 30,
    });
    const markup = html({ heroAgorot: 11800 });
    expect(markup).toContain('data-testid="hero-calc-cap"');
    expect(markup).toContain('בניכוי מה שמעל סכום החשבונית');
    expect(markup).toMatch(/data-money-sum-of="hero-calc" data-money-agorot="11800" data-money-cap-agorot="11800"/);
    expect(markup).not.toMatch(/[−-]\s?₪|₪\s?[−-]/);
  });
});

describe('the panel never shows rows that do not prove THIS hero (v4 H3)', () => {
  it('a match landed since the page loaded: "the sum changed" and a refresh, no rows', () => {
    query.result = ok(LAB);
    const markup = html({ heroAgorot: 70000 });
    expect(markup).toContain('data-testid="hero-calc-changed"');
    expect(markup).toContain('הסכום התעדכן מאז שהדף נטען');
    expect(markup).toMatch(/<button type="button"[^>]*>.*רענון<\/button>/);
    expect(markup).not.toContain('data-money-row-of');
  });

  it('another month’s report never stands under this hero', () => {
    query.result = ok({ ...LAB, hero: { ...LAB.hero, monthStart: '2026-11-30T22:00:00.000Z' } });
    expect(html()).toContain('data-testid="hero-calc-changed"');
  });

  it('a failed read: "לא נטען" and "נסו שוב" (a retry, not a refresh)', () => {
    query.result = { data: undefined, isError: true, isFetching: false, refetch: async () => undefined };
    const markup = html();
    expect(markup).toMatch(/role="status" data-testid="hero-calc-failed"/);
    expect(markup).toContain('לא נטען');
    expect(markup).toContain('נסו שוב');
  });

  it('loading: a delayed skeleton in a busy region (screen readers are told it is loading)', () => {
    const markup = html();
    expect(markup).toMatch(/<div aria-busy="true" data-testid="hero-calc-loading"/);
    // DS3-01's <Skeleton delayed>: the wait is the `--dur-skeleton-wait` token (SPEC §9's one second), no longer `delay-1000`.
    expect(markup).toContain('[transition-delay:var(--dur-skeleton-wait,0ms)]');
    expect(markup).toContain('[@starting-style]:opacity-0');
  });
});

describe('the rows are read on the first open of the fold, never on every home load (v2 A2)', () => {
  it('inside a closed fold: nothing rendered, the query disabled, with the hero’s month and the panel’s cache rules', () => {
    query.result = ok(LAB);
    const markup = renderToStaticMarkup(h(HeroFold, { label: 'איך הגענו לסכום?', panelLabel: 'החישוב' }, h(CalcRows, props())));
    expect(markup).not.toContain('hero-calc');
    expect(query.calls).toHaveLength(1);
    expect(query.calls[0]).toEqual([{ month: '2026-11' }, { enabled: false, staleTime: 60_000, refetchOnWindowFocus: false }]);
  });

  it('bounds that did not parse: the query never runs, the panel says it did not load', () => {
    const markup = html({ month: null });
    expect((query.calls[0]![1] as { enabled: boolean }).enabled).toBe(false);
    expect(markup).toContain('data-testid="hero-calc-failed"');
  });
});
