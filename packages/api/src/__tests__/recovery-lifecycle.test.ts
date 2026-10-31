import { describe, expect, it } from 'vitest';
import { RECOVERY_STATUSES } from '@restomatch/db';
import { ageingBucket, allocateCredit, canTransition, RECOVERY_TRANSITIONS } from '../recovery/lifecycle';
import { summarize, type RecoveryClaimRow } from '../recovery/service';
import { visualOrder } from '../reports/bidi';
import { formatIlsAgorot } from '../reports/money';

describe('recovery lifecycle', () => {
  it('walks the happy path and refuses jumps backwards', () => {
    expect(canTransition('claimed', 'letter_sent')).toBe(true);
    expect(canTransition('letter_sent', 'acknowledged')).toBe(true);
    expect(canTransition('credited', 'recovered')).toBe(true);
    expect(canTransition('recovered', 'claimed')).toBe(false);
    expect(canTransition('acknowledged', 'letter_sent')).toBe(false);
    expect(canTransition('written_off', 'claimed')).toBe(true);
  });

  it('never enters `credited` by a bare transition (only through a credit note)', () => {
    for (const from of RECOVERY_STATUSES) expect(RECOVERY_TRANSITIONS[from]).not.toContain('credited');
  });

  it('allocates a credit note oldest-first, in integer agorot, never over the note or the claim', () => {
    const claims = [
      { id: 'a', amountAgorot: 1600, creditedAgorot: 0 },
      { id: 'b', amountAgorot: 999, creditedAgorot: 500 },
      { id: 'c', amountAgorot: 3000, creditedAgorot: 0 },
    ];
    expect(allocateCredit(2000, claims)).toEqual({
      allocations: [
        { id: 'a', agorot: 1600 },
        { id: 'b', agorot: 400 },
      ],
      remainder: 0,
    });
    expect(allocateCredit(10_000, claims).remainder).toBe(10_000 - 1600 - 499 - 3000);
    expect(() => allocateCredit(12.5, claims)).toThrow();
    expect(() => allocateCredit(0, claims)).toThrow();
  });

  it('buckets ages 0–30 / 31–60 / 61–90 / 90+', () => {
    expect([0, 30, 31, 60, 61, 90, 91].map(ageingBucket)).toEqual([
      'd0_30',
      'd0_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'd90p',
    ]);
  });

  it('summarize: totals, outstanding, ageing and per-supplier rate add up to the agora', () => {
    const base = {
      supplierNameEn: null,
      invoiceId: null,
      invoiceNumber: null,
      discrepancyType: 'PRICE_HIGHER',
      productName: null,
      productNameEn: null,
      lineDescription: null,
      lineDescriptionEn: null,
      discrepancyId: 'd',
      claimedAt: '2026-10-01T00:00:00.000Z',
      letterSentAt: null,
      acknowledgedAt: null,
      creditedAt: null,
      recoveredAt: null,
      closedAt: null,
      lastReminderAt: null,
      overdue: false,
      creditNoteNumber: null,
      note: null,
    };
    const rows: RecoveryClaimRow[] = [
      { ...base, id: '1', status: 'recovered', amountAgorot: 1000, creditedAgorot: 1000, outstandingAgorot: 0, supplierId: 's1', supplierName: 'A', ageDays: 40 },
      { ...base, id: '2', status: 'credited', amountAgorot: 1000, creditedAgorot: 600, outstandingAgorot: 400, supplierId: 's1', supplierName: 'A', ageDays: 10 },
      { ...base, id: '3', status: 'letter_sent', amountAgorot: 2501, creditedAgorot: 0, outstandingAgorot: 2501, supplierId: 's2', supplierName: 'B', ageDays: 95, overdue: true },
      { ...base, id: '4', status: 'written_off', amountAgorot: 300, creditedAgorot: 0, outstandingAgorot: 0, supplierId: 's2', supplierName: 'B', ageDays: 70 },
    ];
    const s = summarize(rows);
    expect(s.claimedAgorot).toBe(4801);
    expect(s.creditedAgorot).toBe(1600);
    expect(s.recoveredAgorot).toBe(1000);
    expect(s.outstandingAgorot).toBe(2901);
    expect(s.writtenOffAgorot).toBe(300);
    expect(s.claimedAgorot).toBe(s.creditedAgorot + s.outstandingAgorot + s.writtenOffAgorot);
    expect(s.ageing).toEqual({ d0_30: 400, d31_60: 0, d61_90: 0, d90p: 2501 });
    expect(s.overdueCount).toBe(1);
    const a = s.bySupplier.find((x) => x.supplierId === 's1')!;
    expect(a.recoveryRate).toBeCloseTo(0.8);
    expect(s.bySupplier[0]!.supplierId).toBe('s2'); // most outstanding first
  });
});

describe('PDF bidi reordering', () => {
  it('reverses Hebrew, keeps numbers and Latin readable, in both paragraph directions', () => {
    expect(visualOrder('שלום', 'rtl')).toBe('םולש');
    expect(visualOrder('סה״כ 1,234 ₪', 'rtl')).toBe('₪ 1,234 כ״הס');
    expect(visualOrder('דליפה 1.6% מהרכש', 'rtl')).toBe('שכרהמ 1.6% הפילד');
    expect(visualOrder('Top supplier: ירקות השרון (₪120)', 'ltr')).toBe('Top supplier: ןורשה תוקרי (₪120)');
    expect(visualOrder('Plain English 12', 'ltr')).toBe('Plain English 12');
    expect(visualOrder('‏1,234 ₪', 'rtl')).toBe('1,234 ₪');
  });

  it('mirrors brackets inside RTL text', () => {
    expect(visualOrder('ספק (3)', 'rtl')).toBe('(3) קפס');
  });
});

describe('server ₪ formatting', () => {
  it('formats integer agorot like the web formatIls (he default, en on request)', () => {
    expect(formatIlsAgorot(123456)).toBe(new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(1234.56));
    expect(formatIlsAgorot(123456, { locale: 'en' })).toBe('₪1,235');
    expect(formatIlsAgorot(123456, { locale: 'en', maximumFractionDigits: 2 })).toBe('₪1,234.56');
  });
});

describe('PDF runs vs fontkit script detection', () => {
  it('hands fontkit only pure-Hebrew runs, pre-reversed (fontkit reverses Hebrew runs wholesale)', async () => {
    const { pdfRuns } = await import('../reports/pdf');
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    const { REGULAR_TTF_BASE64 } = await import('../reports/fonts/reportFont');
    const font = fontkit.create(Buffer.from(REGULAR_TTF_BASE64, 'base64'));
    const drawn = (text: string, dir: 'rtl' | 'ltr') =>
      pdfRuns(visualOrder(text, dir))
        .map((r) => font.layout(r).glyphs.map((g: { codePoints: number[] }) => String.fromCodePoint(...g.codePoints)).join(''))
        .join('');
    // What ends up on the page, left to right:
    expect(drawn('דוח חודשי · אוקטובר 2026', 'rtl')).toBe('2026 רבוטקוא · ישדוח חוד');
    expect(drawn('2.0% מהרכש', 'rtl')).toBe('שכרהמ 2.0%');
    expect(drawn('1. Price (3)', 'ltr')).toBe('1. Price (3)');
    expect(drawn('Top: ירקות השרון', 'ltr')).toBe('Top: ןורשה תוקרי');
  });
});

describe('bidi: numbers in RTL lines (refuter case)', () => {
  it('keeps "amount · percent" in reading order after Hebrew', () => {
    // Visual (left→right) of: ספק 1,234 ₪ · 1.6%  →  1.6% · ₪ 1,234 קפס
    expect(visualOrder('ספק 1,234 ₪ · 1.6%', 'rtl')).toBe('1.6% · ₪ 1,234 קפס');
    expect(visualOrder('INV 12 ספק', 'rtl')).toBe('קפס INV 12');
  });
});
