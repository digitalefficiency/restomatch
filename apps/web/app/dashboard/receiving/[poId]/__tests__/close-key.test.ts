import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCloseKey, closeKeyFor, uncountedLinesOf } from '../_closeKey';

function installStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  });
  return data;
}

describe('the close mutation id (W2-05: one close per intent)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is stable per receipt + cycle across retries and reloads, new per cycle, gone after the close', () => {
    const data = installStorage();
    const a = closeKeyFor('gr-1', 'v1');
    expect(closeKeyFor('gr-1', 'v1')).toBe(a);
    expect(closeKeyFor('gr-1', 'v2')).not.toBe(a); // reopened: a new close intent
    clearCloseKey('gr-1', 'v1');
    expect(data.has('rm-rcv-close:gr-1:v1')).toBe(false);
  });

  it('reads PRECONDITION_FAILED {uncounted_lines} only', () => {
    expect(uncountedLinesOf({ data: { code: 'PRECONDITION_FAILED' }, message: '{"uncounted_lines":7}' })).toBe(7);
    expect(uncountedLinesOf({ data: { code: 'CONFLICT' }, message: '{"uncounted_lines":7}' })).toBeNull();
    expect(uncountedLinesOf({ data: { code: 'PRECONDITION_FAILED' }, message: 'nope' })).toBeNull();
    expect(uncountedLinesOf(new TypeError('Failed to fetch'))).toBeNull();
  });
});
