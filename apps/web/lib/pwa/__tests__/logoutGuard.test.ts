import { describe, expect, it, vi } from 'vitest';
import { runLogoutGuard, type LogoutChoice, type LogoutGuardDeps } from '../logoutGuard';

function deps(over: Partial<LogoutGuardDeps> & { queued?: number; remaining?: number; choice?: LogoutChoice } = {}) {
  const d = {
    countMine: vi.fn().mockResolvedValue(over.queued ?? 0),
    online: vi.fn().mockReturnValue(true),
    flush: vi.fn().mockResolvedValue(over.remaining ?? 0),
    ask: vi.fn().mockResolvedValue(over.choice ?? 'wait'),
    clearMine: vi.fn().mockResolvedValue(undefined),
    proceed: vi.fn(),
    ...over,
  };
  return d;
}

describe('sign-out with queued invoice photos (mobile-field-01)', () => {
  it('nothing queued: signs out without asking', async () => {
    const d = deps();
    expect(await runLogoutGuard(d)).toBe('signed-out');
    expect(d.proceed).toHaveBeenCalledOnce();
    expect(d.ask).not.toHaveBeenCalled();
    expect(d.clearMine).not.toHaveBeenCalled();
  });

  it('online: uploads first, then signs out — no deletion', async () => {
    const d = deps({ queued: 3, remaining: 0 });
    expect(await runLogoutGuard(d)).toBe('flushed-then-signed-out');
    expect(d.flush).toHaveBeenCalledOnce();
    expect(d.ask).not.toHaveBeenCalled();
    expect(d.clearMine).not.toHaveBeenCalled();
  });

  it('offline: asks with the count and never clears the queue without the explicit delete choice', async () => {
    for (const choice of ['wait', 'keep'] as const) {
      const d = deps({ queued: 3, online: vi.fn().mockReturnValue(false), choice });
      const out = await runLogoutGuard(d);
      expect(d.flush).not.toHaveBeenCalled();
      expect(d.ask).toHaveBeenCalledWith(3);
      expect(d.clearMine).not.toHaveBeenCalled();
      expect(out).toBe(choice === 'wait' ? 'cancelled' : 'kept');
      expect(d.proceed).toHaveBeenCalledTimes(choice === 'wait' ? 0 : 1);
    }
  });

  it('a failed upload falls back to the question with what is still queued', async () => {
    const d = deps({ queued: 3, remaining: 1, choice: 'wait' });
    expect(await runLogoutGuard(d)).toBe('cancelled');
    expect(d.ask).toHaveBeenCalledWith(1);
    expect(d.clearMine).not.toHaveBeenCalled();
  });

  it('a throwing flush keeps everything and asks', async () => {
    const d = deps({ queued: 2, flush: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')), choice: 'keep' });
    expect(await runLogoutGuard(d)).toBe('kept');
    expect(d.ask).toHaveBeenCalledWith(2);
    expect(d.clearMine).not.toHaveBeenCalled();
  });

  it('only the explicit delete choice clears the queue, then signs out', async () => {
    const order: string[] = [];
    const clearMine = vi.fn(async () => {
      order.push('clear');
    });
    const proceed = vi.fn(() => {
      order.push('proceed');
    });
    const d = deps({ queued: 2, online: vi.fn().mockReturnValue(false), choice: 'delete', clearMine, proceed });
    expect(await runLogoutGuard(d)).toBe('deleted');
    expect(clearMine).toHaveBeenCalledOnce();
    expect(order).toEqual(['clear', 'proceed']);
  });
});

describe('PwaSessionGuard wiring', () => {
  it('never wipes the queue directly: no clearQueue / purgeOtherUsers, only the guarded clearMine', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../PwaSessionGuard.tsx', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bclearQueue\s*\(/);
    expect(src).not.toMatch(/\bpurgeOtherUsers\s*\(/);
    expect(src).toMatch(/runLogoutGuard\(/);
    // W2-05: the queue is the field outbox; its delete (this user's items, every kind) is reachable
    // only as the guard's clearMine (called after ask → 'delete'). No other delete path in the guard.
    expect(src.match(/clearMineOnDevice\(/g)?.length).toBe(1);
    expect(src).toMatch(/clearMine: \(\) => clearMineOnDevice\(userId\)/);
    expect(src).not.toMatch(/\bclearForUser\s*\(|\bremoveItem\s*\(|\.remove\(/);
  });
});
