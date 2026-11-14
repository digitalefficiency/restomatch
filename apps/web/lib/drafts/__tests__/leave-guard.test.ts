import { describe, expect, it, vi } from 'vitest';
import { attachLeaveGuard, leaveNow, syncGuardEntry, type LeaveGuardEnv, type LeaveGuardState, type LeaveTarget } from '../leaveGuard';

/** A fake window/document that records listeners and history calls. */
function fakeEnv(path = '/dashboard/receiving/po-1') {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const on = (t: string, fn: (e: unknown) => void) => {
    if (!listeners.has(t)) listeners.set(t, new Set());
    listeners.get(t)!.add(fn);
  };
  const off = (t: string, fn: (e: unknown) => void) => listeners.get(t)?.delete(fn);
  const location = {
    href: `https://app.test${path}`,
    origin: 'https://app.test',
    pathname: path,
    assign: vi.fn(),
  };
  const history = { state: { k: 1 }, pushState: vi.fn(), back: vi.fn(), go: vi.fn() };
  const env = {
    window: { addEventListener: on, removeEventListener: off, history, location },
    document: { addEventListener: on, removeEventListener: off },
  } as unknown as LeaveGuardEnv;
  const fire = (t: string, e: unknown) => [...(listeners.get(t) ?? [])].forEach((fn) => fn(e));
  return { env, history, location, fire, listeners };
}

function state(dirty: boolean, ask = vi.fn<(t: LeaveTarget) => void>()): LeaveGuardState {
  return { dirty, ask, guardPushed: false, bypass: false };
}

function click(href: string, extra: Record<string, unknown> = {}) {
  const a = { href, target: '', hasAttribute: () => false };
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target: { closest: () => a },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  };
}

describe('lib/drafts useLeaveGuard core (hoisted from receiving _fieldHooks)', () => {
  it('beforeunload blocks only while dirty and not bypassed', () => {
    const f = fakeEnv();
    const s = state(false);
    attachLeaveGuard(f.env, s);
    const clean = { preventDefault: vi.fn(), returnValue: 'x' };
    f.fire('beforeunload', clean);
    expect(clean.preventDefault).not.toHaveBeenCalled();
    s.dirty = true;
    const dirty = { preventDefault: vi.fn(), returnValue: 'x' };
    f.fire('beforeunload', dirty);
    expect(dirty.preventDefault).toHaveBeenCalled();
    expect(dirty.returnValue).toBe('');
  });

  it('an in-app link click while dirty asks with the target; modified/external/same-page clicks pass', () => {
    const f = fakeEnv();
    const s = state(true);
    attachLeaveGuard(f.env, s);
    const e = click('https://app.test/dashboard/orders?x=1#top');
    f.fire('click', e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(s.ask).toHaveBeenCalledWith({ kind: 'href', href: '/dashboard/orders?x=1#top' });

    for (const ev of [
      click('https://app.test/dashboard/orders', { metaKey: true }),
      click('https://app.test/dashboard/orders', { button: 1 }),
      click('https://other.test/x'),
      click('https://app.test/dashboard/receiving/po-1#line-3'),
    ]) {
      f.fire('click', ev);
      expect(ev.preventDefault).not.toHaveBeenCalled();
    }
    expect(s.ask).toHaveBeenCalledTimes(1);
  });

  it('a clean page never asks on click', () => {
    const f = fakeEnv();
    const s = state(false);
    attachLeaveGuard(f.env, s);
    const e = click('https://app.test/dashboard/orders');
    f.fire('click', e);
    expect(s.ask).not.toHaveBeenCalled();
  });

  it('pushes one guard entry when work becomes dirty, never twice', () => {
    const f = fakeEnv();
    const s = state(true);
    syncGuardEntry(f.env, s);
    syncGuardEntry(f.env, s);
    expect(f.history.pushState).toHaveBeenCalledTimes(1);
    expect(f.history.pushState).toHaveBeenCalledWith({ k: 1 }, '', 'https://app.test/dashboard/receiving/po-1');
  });

  it('popstate while dirty re-pushes the guard and asks "back"', () => {
    const f = fakeEnv();
    const s = state(true);
    attachLeaveGuard(f.env, s);
    syncGuardEntry(f.env, s);
    f.fire('popstate', {});
    expect(f.history.pushState).toHaveBeenCalledTimes(2);
    expect(s.ask).toHaveBeenCalledWith({ kind: 'back' });
  });

  it('popstate after everything was saved takes the real step back (no dead press)', () => {
    const f = fakeEnv();
    const s = state(true);
    attachLeaveGuard(f.env, s);
    syncGuardEntry(f.env, s);
    s.dirty = false;
    f.fire('popstate', {});
    expect(s.ask).not.toHaveBeenCalled();
    expect(f.history.back).toHaveBeenCalledTimes(1);
    expect(s.guardPushed).toBe(false);
  });

  it('leave(): href assigns; back skips the guard entry; nothing asks afterwards', () => {
    const f = fakeEnv();
    const s = state(true);
    attachLeaveGuard(f.env, s);
    syncGuardEntry(f.env, s);
    leaveNow(f.env, s, { kind: 'back' });
    expect(f.history.go).toHaveBeenCalledWith(-2);
    f.fire('popstate', {});
    expect(s.ask).not.toHaveBeenCalled();
    leaveNow(f.env, s, { kind: 'href', href: '/dashboard' });
    expect(f.location.assign).toHaveBeenCalledWith('/dashboard');
  });

  it('back without a guard entry goes one step; cleanup removes every listener', () => {
    const f = fakeEnv();
    const s = state(false);
    const off = attachLeaveGuard(f.env, s);
    leaveNow(f.env, s, { kind: 'back' });
    expect(f.history.go).toHaveBeenCalledWith(-1);
    off();
    expect([...f.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
