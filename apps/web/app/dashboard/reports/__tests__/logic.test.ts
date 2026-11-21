import { describe, expect, it } from 'vitest';
import {
  coverText,
  legacyTarget,
  deltaOf,
  monthKey,
  monthOptions,
  monthsBetween,
  nextSteps,
  parseMonth,
  parseTab,
  previousMonth,
  reportHref,
  statusOf,
  totalsOf,
} from '../monthly/logic';

// 25.10.2026 09:40 Israel (the lab clock).
const NOW = new Date('2026-10-25T06:40:00Z');

describe('tabs', () => {
  it('has the 3 owner tabs, the proof first', () => {
    expect(parseTab(undefined)).toBe('proof');
    expect(parseTab('by')).toBe('by');
    expect(parseTab('sent')).toBe('sent');
    expect(parseTab(['sent', 'by'])).toBe('sent');
    expect(parseTab('email')).toBe('proof');
  });
  it('keeps the month across a tab change', () => {
    expect(reportHref('by', '2026-09')).toBe('/dashboard/reports/monthly?tab=by&month=2026-09');
  });
});

describe('months (Israel time)', () => {
  it('uses the Israel day, not the UTC day', () => {
    // 31.10 22:30 UTC = 1.11 00:30 Israel (IST, +02:00 after 25.10).
    expect(monthKey(0, new Date('2026-10-31T22:30:00Z'))).toBe('2026-11');
    expect(monthKey(-1, new Date('2026-01-15T10:00:00Z'))).toBe('2025-12');
  });
  it('offers 12 months, newest first', () => {
    const o = monthOptions(NOW);
    expect(o).toHaveLength(12);
    expect(o[0]).toBe('2026-10');
    expect(o[11]).toBe('2025-11');
  });
  it('parses month=, then the old m= offset, inside the window', () => {
    expect(parseMonth({ month: '2026-09' }, NOW)).toBe('2026-09');
    expect(parseMonth({ month: '2024-01' }, NOW)).toBe('2026-10');
    expect(parseMonth({ month: 'nope' }, NOW)).toBe('2026-10');
    expect(parseMonth({ m: '-1' }, NOW)).toBe('2026-09');
    expect(parseMonth({ m: '3' }, NOW)).toBe('2026-10');
    expect(parseMonth({ m: '-40' }, NOW)).toBe('2026-10');
    expect(parseMonth({}, NOW)).toBe('2026-10');
  });
  it('counts months and steps back across a year', () => {
    expect(monthsBetween('2026-10', '2026-09')).toBe(-1);
    expect(monthsBetween('2026-01', '2025-11')).toBe(-2);
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
  });
});

describe('status pill', () => {
  it('a live month is open as of now; a snapshot is closed on its date', () => {
    expect(statusOf({ frozen: false, generatedAt: '2026-10-01T05:00:00Z' }, NOW)).toEqual({ state: 'open', asOf: NOW.toISOString() });
    expect(statusOf({ frozen: true, generatedAt: '2026-10-01T04:45:00Z' }, NOW)).toEqual({ state: 'closed', closedOn: '2026-10-01T04:45:00Z' });
  });
});

describe('next steps', () => {
  const ctx = {
    month: '2026-09',
    thisMonth: '2026-10',
    suppliers: [
      { supplierId: 's-1', supplierName: 'תנובה' },
      { supplierId: null, supplierName: 'ללא ספק' },
    ],
  };
  it('maps each action to a T2 row with ₪ and one verb link', () => {
    const s = nextSteps(
      [
        { code: 'chaseOverdue', params: { count: 15, agorot: 85915 } },
        { code: 'decideOpen', params: { count: 4, agorot: 29600 } },
        { code: 'sendClaims', params: { count: 6, agorot: 45088 } },
        { code: 'linkPending', params: { count: 2 } },
      ],
      ctx,
    );
    expect(s.map((x) => [x.code, x.tier, x.agorot, x.count, x.href])).toEqual([
      ['chaseOverdue', 'T2', 85915, 15, '/dashboard/recovery'],
      ['decideOpen', 'T2', 29600, 4, '/dashboard/approvals'],
      ['sendClaims', 'T2', 45088, 6, '/dashboard/leaks/claims'],
      ['linkPending', 'T2', null, 2, '/dashboard/leaks/breakdown?m=-1'],
    ]);
  });
  it('G-08: held invoices ask "is this the same product?" on the mapping screen', () => {
    const [q] = nextSteps([{ code: 'answerQuestions', params: { count: 3 } }], ctx);
    expect(q).toMatchObject({ code: 'answerQuestions', tier: 'T2', agorot: null, count: 3, href: '/dashboard/catalog/mapping' });
  });
  it('links the supplier step to that supplier when the breakdown names it', () => {
    const [a] = nextSteps([{ code: 'talkToSupplier', params: { supplier: 'תנובה', supplierEn: 'Tnuva', pct: 0.021 } }], ctx);
    expect(a).toMatchObject({ tier: 'T2', href: '/dashboard/suppliers/s-1', supplier: { he: 'תנובה', en: 'Tnuva' }, pct: 0.021 });
    const [b] = nextSteps([{ code: 'talkToSupplier', params: { supplier: 'ללא ספק', pct: 0.03 } }], ctx);
    expect(b!.href).toBe('/dashboard/suppliers');
  });
  it('all clear is the one calm T3 row, also when there are no actions', () => {
    expect(nextSteps([{ code: 'allClear', params: {} }], ctx)).toEqual([{ code: 'allClear', tier: 'T3', agorot: null, count: null, href: null }]);
    expect(nextSteps([], ctx)[0]!.tier).toBe('T3');
  });
  it('links pending invoices to this month without an offset', () => {
    expect(nextSteps([{ code: 'linkPending', params: { count: 1 } }], { month: '2026-10', thisMonth: '2026-10' })[0]!.href).toBe(
      '/dashboard/leaks/breakdown',
    );
  });
});

describe('delta', () => {
  it('is colour-only-when-bad', () => {
    expect(deltaOf(76000, 74600)).toEqual({ agorot: 1400, direction: 'up', bad: true });
    expect(deltaOf(74600, 76000)).toEqual({ agorot: -1400, direction: 'down', bad: false });
    expect(deltaOf(100, 100)).toEqual({ agorot: 0, direction: 'same', bad: false });
    expect(deltaOf(100, null)).toBeNull();
  });
});

describe('totals add up to the number, to the agora', () => {
  it('sums in integer agorot (no float drift)', () => {
    // 0.1 + 0.2 in ₪ floats is 0.30000000000000004; in agorot it is exactly 30.
    expect(totalsOf([0.1, 0.2], 30)).toEqual({ sumAgorot: 30, gapAgorot: 0, matches: true });
    expect(totalsOf([853.74 - 400, 400], 85374).matches).toBe(true);
  });
  it('reports the gap when the rows sit above the number (the per-invoice cap)', () => {
    expect(totalsOf([500, 400], 85374)).toEqual({ sumAgorot: 90000, gapAgorot: 4626, matches: false });
  });
});

describe('D11: the cover never shows ₪', () => {
  it('passes month and restaurant text', () => {
    expect(coverText(['דוח החודש', 'אוקטובר 2026', 'כפר הזיתים'])).toHaveLength(3);
  });
  it('throws on a shekel figure', () => {
    expect(() => coverText(['דוח החודש', '₪853.74'])).toThrow(/D11/);
  });
});

describe('legacy month pages land on their tab (308)', () => {
  it('digest → sent, proof → proof, leak report → by; the month is kept only when valid', () => {
    expect(legacyTarget('/dashboard/reports/digest', '2026-09')).toBe('/dashboard/reports/monthly?tab=sent&month=2026-09');
    expect(legacyTarget('/dashboard/reports/digest', undefined)).toBe('/dashboard/reports/monthly?tab=sent');
    expect(legacyTarget('/dashboard/leaks/proof', 'x')).toBe('/dashboard/reports/monthly?tab=proof');
    expect(legacyTarget('/dashboard/leaks/report', '2026-10')).toBe('/dashboard/reports/monthly?tab=by&month=2026-10');
  });
});

describe('partner wording (GLOSSARY §1)', () => {
  it('the reports namespace never demands', async () => {
    const { he } = await import('@/lib/i18n/messages/reports/he');
    const values = (o: unknown): string[] =>
      typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(values) : [];
    const banned = /דריש|תביע|מחלוק|חוב(?![א-ת])|באיחור|לגבות|לגבייה|ויתרנו/;
    expect(values(he).filter((v) => banned.test(v))).toEqual([]);
  });
});
