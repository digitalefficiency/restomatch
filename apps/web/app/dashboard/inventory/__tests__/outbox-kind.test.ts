import { describe, expect, it } from 'vitest';
import { backoffMs, interimQueue, inventoryLinesKind, migrateLegacyPending } from '../count/_outbox';
import { mergeRetry } from '../inventory-ui';

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}
const ME = { userId: 'u-me', name: 'מיכל' };
const DANA = { userId: 'u-dana', name: 'דנה' };

describe('inventoryLines outbox kind (W2-07 · deep-fix class 2)', () => {
  it('identity: one item per count + product (a newer edit replaces it); one group per count', () => {
    const p = { countId: 'c1', productId: 'p1', edit: { qty: '2' }, by: ME, at: 0 };
    expect(inventoryLinesKind.idempotencyKey(p)).toBe('c1:p1');
    expect(inventoryLinesKind.group(p)).toBe('inventory:c1');
  });

  it('migrates the old pendingStore rows with zero loss, under anything already queued', () => {
    const s = memStorage();
    s.setItem('rm.inventory.pending.c1', JSON.stringify({ p1: { qty: '5' }, p2: { qty: '1', storageArea: 'dry' } }));
    const q = interimQueue('c1', s);
    q.put({ p2: { qty: '3' } }, ME);
    expect(migrateLegacyPending('c1', s)).toBe(2);
    expect(s.getItem('rm.inventory.pending.c1')).toBeNull();
    // p2: the newer queued qty wins, the legacy area change is kept (mergeRetry parity).
    expect(q.edits()).toEqual({ p1: { qty: '5' }, p2: mergeRetry({ p2: { qty: '1', storageArea: 'dry' } }, { p2: { qty: '3' } }).p2 });
    expect(q.edits().p2).toEqual({ qty: '3', storageArea: 'dry' });
    // Idempotent.
    expect(migrateLegacyPending('c1', s)).toBe(0);
    expect(q.size()).toBe(2);
  });

  it('ack drops exactly what was sent; an edit typed meanwhile stays queued (exactly-once effect)', () => {
    const s = memStorage();
    const q = interimQueue('c1', s);
    q.put({ p1: { qty: '1' }, p2: { qty: '2' } }, ME);
    const sent = q.edits();
    q.put({ p2: { qty: '20' } }, ME); // typed while the batch was on the wire
    q.ack(sent);
    expect(q.edits()).toEqual({ p2: { qty: '20' } });
    q.ack(q.edits());
    expect(q.size()).toBe(0);
  });

  it("a colleague's queued edits are attributed (decision 22)", () => {
    const s = memStorage();
    interimQueue('c1', s).put({ p1: { qty: '4' } }, DANA);
    const q = interimQueue('c1', s);
    expect(q.othersBy(ME.userId)).toEqual(['דנה']);
    expect(q.othersBy(DANA.userId)).toEqual([]);
  });

  it('backoff: 2/4/8…60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });

  it('survives missing / throwing storage', () => {
    const q = interimQueue('c1', null);
    q.put({ p1: { qty: '1' } }, ME);
    expect(q.size()).toBe(0);
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => undefined };
    expect(() => interimQueue('c1', bad).put({ p1: { qty: '1' } }, ME)).not.toThrow();
    expect(migrateLegacyPending('c1', bad)).toBe(0);
  });
});
