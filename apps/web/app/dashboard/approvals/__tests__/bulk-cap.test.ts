import { describe, expect, it } from 'vitest';
import { DEFAULT_BULK_CAP_AGOROT } from '@/lib/components/table/selection';
import {
  BULK_APPROVE_CAP_AGOROT,
  bulkRefusals,
} from '../../../../../../packages/api/src/approvals/bulkPolicy';
import { BULK_CAP_AGOROT, bulkSelection, groupByInvoice, groupPrimary, type DeskRow } from '../groups';

/**
 * W2-04 §5.1 + §5.3: the web cap IS the server cap, and the group-primary /
 * BatchBar rules refuse exactly what the server refuses.
 */
const row = (id: string, o: Partial<DeskRow> = {}): DeskRow => ({
  id,
  invoiceId: 'inv-1',
  invoiceNumber: 'ST-24108',
  supplierName: 'משקאות שטיינברג',
  severity: 'warn',
  resolutionStatus: 'open',
  claimable: true,
  claimAgorot: 5_000,
  canAct: true,
  ...o,
});

describe('one cap', () => {
  it('DEFAULT_BULK_CAP_AGOROT === BULK_APPROVE_CAP_AGOROT === ₪200.00', () => {
    expect(DEFAULT_BULK_CAP_AGOROT).toBe(BULK_APPROVE_CAP_AGOROT);
    expect(BULK_CAP_AGOROT).toBe(BULK_APPROVE_CAP_AGOROT);
    expect(BULK_APPROVE_CAP_AGOROT).toBe(20_000);
  });
});

describe('groupByInvoice', () => {
  it('groups by invoice in server order, sums only claimable ₪', () => {
    const g = groupByInvoice([
      row('a'),
      row('b', { invoiceId: 'inv-2' }),
      row('c', { claimable: false, claimAgorot: 0, severity: 'info' }),
      row('d', { invoiceId: null }),
    ]);
    expect(g.map((x) => [x.key, x.rows.map((r) => r.id), x.claimAgorot])).toEqual([
      ['inv-1', ['a', 'c'], 5_000],
      ['inv-2', ['b'], 5_000],
      ['row:d', ['d'], 5_000],
    ]);
  });
});

describe('group primary', () => {
  const g = (rows: DeskRow[]) => groupPrimary(groupByInvoice(rows)[0]!);
  it('only when ≥2 rows, none block, all mine, ₪ > 0 and ≤ ₪200', () => {
    expect(g([row('a'), row('b')])).toEqual({ ok: true });
    expect(g([row('a')])).toEqual({ ok: false, why: 'single' });
    expect(g([row('a'), row('b', { severity: 'block' })])).toEqual({ ok: false, why: 'block' });
    expect(g([row('a'), row('b', { canAct: false })])).toEqual({ ok: false, why: 'cannotAct' });
    expect(g([row('a', { claimAgorot: 15_000 }), row('b', { claimAgorot: 5_001 })])).toEqual({ ok: false, why: 'overCap' });
    expect(g([row('a', { claimAgorot: 15_000 }), row('b', { claimAgorot: 5_000 })])).toEqual({ ok: true });
    expect(
      g([row('a', { claimable: false, claimAgorot: 0 }), row('b', { claimable: false, claimAgorot: 0 })]),
    ).toEqual({ ok: false, why: 'noClaim' });
  });
});

describe('BatchBar selection = server refusals', () => {
  it('refuses a block row, and every row of an invoice over ₪200 — like bulkRefusals', () => {
    const rows = [
      row('a', { claimAgorot: 15_000 }),
      row('b', { claimAgorot: 5_001 }),
      row('c', { invoiceId: 'inv-2', claimAgorot: 100 }),
      row('d', { invoiceId: 'inv-3', severity: 'block' }),
    ];
    const sel = bulkSelection(rows, new Set(['a', 'b', 'c', 'd']));
    expect(sel.disabled).toBe(true);
    expect(sel.sumAgorot).toBe(25_101);
    const server = bulkRefusals(rows.map((r) => ({ ...r, discrepancyId: r.id })));
    expect(Object.fromEntries(sel.blocked.map((b) => [b.id, b.why]))).toEqual(Object.fromEntries(server));
    expect(bulkSelection(rows, new Set(['c'])).disabled).toBe(false);
  });
});
