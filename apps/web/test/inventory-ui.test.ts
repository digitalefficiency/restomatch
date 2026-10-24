import { describe, expect, it } from 'vitest';
import { mergeRetry, normalizeQty, pendingStore } from '../app/dashboard/inventory/inventory-ui';

describe('normalizeQty: what a phone keypad types → the server qty', () => {
  it('a comma + exactly 3 digits is thousands; a comma + 1–2 digits is the decimal', () => {
    expect(normalizeQty('1,200')).toBe('1200');
    expect(normalizeQty('12,000,000')).toBe('12000000');
    expect(normalizeQty('1,200.5')).toBe('1200.5');
    expect(normalizeQty('2,5')).toBe('2.5');
    expect(normalizeQty('2,25')).toBe('2.25');
    expect(normalizeQty(' 3 ')).toBe('3');
    expect(normalizeQty('0.125')).toBe('0.125');
  });

  it('blank is "not counted"; a trailing separator is still being typed (no error, nothing to save)', () => {
    expect(normalizeQty('')).toBe('');
    expect(normalizeQty('2,')).toBeUndefined();
    expect(normalizeQty('2.')).toBeUndefined();
    expect(normalizeQty('1,200,')).toBeUndefined();
  });

  it('anything else is invalid', () => {
    for (const v of ['-1', 'abc', '1,2345', '1.2.3', '1,,2', ',5', '1.23456']) expect(normalizeQty(v), v).toBeNull();
  });
});

describe('mergeRetry: a failed batch goes back under newer edits, field by field', () => {
  it('a newer area change keeps the failed qty; a newer qty wins over the failed one', () => {
    const merged = mergeRetry({ a: { qty: '5' }, b: { qty: '1', storageArea: 'dry' } }, { a: { storageArea: 'bar' }, b: { qty: '2' } });
    expect(merged).toEqual({ a: { qty: '5', storageArea: 'bar' }, b: { qty: '2', storageArea: 'dry' } });
  });
});

describe('pendingStore: unsaved edits survive a reload, per count', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  it('writes, reads back and clears per count id; a broken or missing storage never throws', () => {
    const s = pendingStore('count-1', storage);
    s.write({ p1: { qty: '3' } });
    expect(pendingStore('count-1', storage).read()).toEqual({ p1: { qty: '3' } });
    expect(pendingStore('count-2', storage).read()).toEqual({});
    s.write({});
    expect(mem.size).toBe(0);
    mem.set('rm.inventory.pending.count-3', '{not json');
    expect(pendingStore('count-3', storage).read()).toEqual({});
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(pendingStore('x', throwing).read()).toEqual({});
    expect(() => pendingStore('x', throwing).write({ p: { qty: '1' } })).not.toThrow();
    expect(pendingStore('x', null).read()).toEqual({});
  });
});
