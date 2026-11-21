import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetDraftMemory,
  clearDraftsForUser,
  draftKey,
  isCompleteScope,
  readDraftEnvelope,
  removeDraft,
  writeDraftEnvelope,
  type StorageLike,
} from '../store';

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function throwingStorage(): StorageLike {
  const boom = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: boom, setItem: boom, removeItem: boom, key: boom, get length(): number { return boom(); } };
}

const A = { userId: 'u1', restaurantId: 'r1' };
const B = { userId: 'u2', restaurantId: 'r1' };

beforeEach(() => __resetDraftMemory());

describe('lib/drafts store (useFormDraft persistence)', () => {
  it('scopes keys user:restaurant:key', () => {
    expect(draftKey(A, 'count:po-1')).toBe('rm.draft:u1:r1:count:po-1');
    expect(isCompleteScope({ userId: 'u1', restaurantId: '' })).toBe(false);
    expect(isCompleteScope(null)).toBe(false);
  });

  it('round-trips a draft and keeps users apart on one device', () => {
    const st = memStorage();
    writeDraftEnvelope(A, 'k', { qty: '12' }, 1, st, 1000);
    expect(readDraftEnvelope(A, 'k', { version: 1 }, st)).toEqual({ v: 1, at: 1000, data: { qty: '12' } });
    expect(readDraftEnvelope(B, 'k', { version: 1 }, st)).toBeNull();
  });

  it('a version bump drops the old draft (and deletes it)', () => {
    const st = memStorage();
    writeDraftEnvelope(A, 'k', { qty: '12' }, 1, st);
    expect(readDraftEnvelope(A, 'k', { version: 2 }, st)).toBeNull();
    expect(st.map.size).toBe(0);
  });

  it('ttl expiry drops the draft', () => {
    const st = memStorage();
    writeDraftEnvelope(A, 'k', 'x', 1, st, 1000);
    expect(readDraftEnvelope(A, 'k', { version: 1, ttlMs: 500, now: 1400 }, st)?.data).toBe('x');
    expect(readDraftEnvelope(A, 'k', { version: 1, ttlMs: 500, now: 1600 }, st)).toBeNull();
  });

  it('corrupt JSON reads as no draft, never throws', () => {
    const st = memStorage();
    st.map.set(draftKey(A, 'k'), '{not json');
    expect(readDraftEnvelope(A, 'k', { version: 1 }, st)).toBeNull();
  });

  it('a throwing localStorage (private mode) falls back to memory: nothing throws, the draft survives', () => {
    const st = throwingStorage();
    expect(() => writeDraftEnvelope(A, 'k', 'typed', 1, st)).not.toThrow();
    expect(readDraftEnvelope(A, 'k', { version: 1 }, st)?.data).toBe('typed');
    expect(() => removeDraft(A, 'k', st)).not.toThrow();
    expect(readDraftEnvelope(A, 'k', { version: 1 }, st)).toBeNull();
    expect(readDraftEnvelope(A, 'k', { version: 1 }, null)).toBeNull();
  });

  it('clearDraftsForUser drops only that user, in every restaurant, storage and memory', () => {
    const st = memStorage();
    writeDraftEnvelope(A, 'a', 1, 1, st);
    writeDraftEnvelope({ userId: 'u1', restaurantId: 'r2' }, 'b', 1, 1, st);
    writeDraftEnvelope(B, 'a', 1, 1, st);
    writeDraftEnvelope(A, 'mem', 1, 1, throwingStorage());
    st.map.set('unrelated', 'x');
    expect(clearDraftsForUser('u1', st)).toBe(3);
    expect([...st.map.keys()].sort()).toEqual(['rm.draft:u2:r1:a', 'unrelated']);
    expect(readDraftEnvelope(A, 'mem', { version: 1 }, null)).toBeNull();
    expect(clearDraftsForUser('', st)).toBe(0);
  });
});
