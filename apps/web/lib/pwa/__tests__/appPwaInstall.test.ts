import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_STATE,
  INSTALL_KEY,
  REASK_AFTER_MS,
  isIosSafari,
  loadState,
  parseState,
  persistStorage,
  saveState,
  shouldOffer,
  withAsked,
  withCompletedTask,
  withInstalled,
} from '../install';
import { applyAppBadge, openT2Count } from '../badge';

const NOW = Date.UTC(2026, 10, 21, 8);

describe('install policy (W3-03b)', () => {
  const after = (n: number) => Array.from({ length: n }).reduce<typeof EMPTY_STATE>((s) => withCompletedTask(s), EMPTY_STATE);

  it('offers only after the 2nd completed task', () => {
    expect(shouldOffer(after(1), NOW, 'prompt', false)).toBe(false);
    expect(shouldOffer(after(2), NOW, 'prompt', false)).toBe(true);
    expect(shouldOffer(after(2), NOW, 'ios', false)).toBe(true);
  });
  it('never re-asks within 14 days, then may again', () => {
    const asked = withAsked(after(3), NOW);
    expect(shouldOffer(asked, NOW + REASK_AFTER_MS - 1, 'prompt', false)).toBe(false);
    expect(shouldOffer(asked, NOW + REASK_AFTER_MS, 'prompt', false)).toBe(true);
  });
  it('never when installed, standalone, or the platform cannot install', () => {
    expect(shouldOffer(withInstalled(after(5)), NOW, 'prompt', false)).toBe(false);
    expect(shouldOffer(after(5), NOW, 'prompt', true)).toBe(false);
    expect(shouldOffer(after(5), NOW, 'none', false)).toBe(false);
  });
  it('state survives garbage and blocked storage', () => {
    expect(parseState('{nope')).toEqual(EMPTY_STATE);
    expect(parseState('{"completed":-3,"lastAskedAt":"x","installed":"yes"}')).toEqual(EMPTY_STATE);
    const mem = new Map<string, string>();
    const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveState(kv, withAsked(after(2), NOW));
    expect(mem.has(INSTALL_KEY)).toBe(true);
    expect(loadState(kv)).toEqual({ completed: 2, lastAskedAt: NOW, installed: false });
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadState(blocked)).toEqual(EMPTY_STATE);
    expect(() => saveState(blocked, after(1))).not.toThrow();
  });
  it('detects iOS Safari (not Chrome on iOS)', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(isIosSafari(iphone)).toBe(true);
    expect(isIosSafari(iphone.replace('Version/17.0', 'CriOS/120.0'))).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 5)).toBe(true);
    expect(isIosSafari('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36')).toBe(false);
  });
  it('asks storage to persist once installed; never throws', async () => {
    const persist = vi.fn(async () => true);
    expect(await persistStorage({ persist, persisted: async () => false })).toBe(true);
    expect(persist).toHaveBeenCalled();
    expect(await persistStorage({ persist, persisted: async () => true })).toBe(true);
    expect(await persistStorage(undefined)).toBe(false);
    expect(await persistStorage({ persist: async () => Promise.reject(new Error('x')) })).toBe(false);
  });
});

describe('app badge = open T2 items (W3-03b)', () => {
  it('counts danger + warn once each, never neutral', () => {
    const approvals = { count: 3, tone: 'danger' as const };
    const claims = { count: 2, tone: 'warn' as const };
    const pending = { count: 9, tone: 'neutral' as const };
    // One server badge mapped onto two routes is counted once.
    expect(openT2Count({ '/dashboard/approvals': approvals, '/dashboard/approvals/pay-run': approvals, '/dashboard/leaks/claims': claims, '/dashboard/invoices': pending })).toBe(5);
    expect(openT2Count({})).toBe(0);
  });
  it('sets or clears where supported; never throws', async () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    expect(await applyAppBadge({ setAppBadge, clearAppBadge }, 4)).toBe(true);
    expect(setAppBadge).toHaveBeenCalledWith(4);
    expect(await applyAppBadge({ setAppBadge, clearAppBadge }, 0)).toBe(true);
    expect(clearAppBadge).toHaveBeenCalled();
    expect(await applyAppBadge({}, 2)).toBe(false);
    expect(await applyAppBadge({ setAppBadge: async () => Promise.reject(new Error('x')) }, 2)).toBe(false);
  });
});
