import { describe, expect, it } from 'vitest';
import { registerColumns, visibleTotals, ddmmyyyy, STATE_TONE, type RegisterRow, type RegisterCopy } from '../columns';
import { inTab } from '../register-client';

const copy: RegisterCopy = {
  col: { date: 'd', supplier: 's', number: 'n', total: 't', due: 'du', gap: 'g', status: 'st', allocation: 'a' },
  state: {
    in_ocr: '1', awaiting_count: '2', awaiting_link: '3', clean: '4', flagged_open: '5',
    claim_open: '6', held_duplicate: '7', approved: '8', paid: '9',
  },
  allocationYes: 'y',
  allocationNo: 'n',
  consolidated: 'c',
};
const row = (over: Partial<RegisterRow>): RegisterRow => ({
  id: 'x', invoiceNumber: 'MF-1', invoiceDate: '2026-10-05T10:00:00Z', dueDate: null, supplierName: 'ספק',
  totalInclVatAgorot: 11700, gapAgorot: 0, state: 'clean', tab: 'matched', hasAllocation: true, consolidated: false, ...over,
});

describe('register columns (W2-02)', () => {
  const cols = registerColumns(copy, 'he');
  it('money columns are money kind with one precision (right-aligned by the NUM cell)', () => {
    for (const id of ['total', 'gap']) {
      const c = cols.find((x) => x.id === id)!;
      expect(c.kind).toBe('money');
      expect(c.decimals).toBe(2);
    }
    expect(cols.find((c) => c.identity)!.id).toBe('supplier');
  });
  it('a gap is unknown (pending), never ₪0, before a match ran', () => {
    const gap = cols.find((c) => c.id === 'gap')!;
    expect(gap.value!(row({ state: 'awaiting_link', tab: 'awaiting' }))).toBeNull();
    expect(gap.cell!(row({ state: 'in_ocr', tab: 'awaiting' }))).toBe('pending');
    expect(gap.value!(row({ state: 'flagged_open', tab: 'review', gapAgorot: 4250 }))).toBe(4250);
  });
  it('totals = Σ visible rows', () => {
    const rows = [row({ id: 'a', totalInclVatAgorot: 100, gapAgorot: 5 }), row({ id: 'b', totalInclVatAgorot: 250, gapAgorot: 0 })];
    expect(visibleTotals(rows)).toEqual({ count: 2, sumAgorot: 350, gapAgorot: 5 });
  });
  it('dates read dd.MM.yyyy', () => {
    expect(ddmmyyyy('2026-10-05T10:00:00Z', 'he')).toBe('05.10.2026');
    expect(ddmmyyyy('2026-10-05T10:00:00Z', 'en')).toBe('05.10.2026');
  });
  it('T4 pending states are neutral, never an alarm; a possible duplicate is T2', () => {
    for (const s of ['awaiting_link', 'awaiting_count', 'in_ocr'] as const) expect(STATE_TONE[s].tone).toBe('neutral');
    expect(STATE_TONE.held_duplicate).toEqual({ tone: 'danger', emphasis: 'bold' });
  });
  it('the noAllocation view excludes invoices still in OCR', () => {
    expect(inTab(row({ hasAllocation: false }), 'noAllocation')).toBe(true);
    expect(inTab(row({ hasAllocation: false, state: 'in_ocr', tab: 'awaiting' }), 'noAllocation')).toBe(false);
    expect(inTab(row({}), 'intake')).toBe(false);
  });
});
