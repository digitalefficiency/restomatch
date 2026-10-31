import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthGate, isSessionExpired } from '../authGate';
import { createLineOutbox, type GrLinePayload } from '../lineOutbox';
import { ScopeChangedError, SessionGoneError, isTransientFailure } from '../offlineQueue';

const row = (grLineId: string, qtyReceived: number): GrLinePayload => ({ grLineId, qtyReceived, qtyRejected: 0, condition: 'ok' });
const unauthorized = () => Object.assign(new Error('UNAUTHORIZED'), { data: { httpStatus: 401, code: 'UNAUTHORIZED' } });

describe('line saves when the session expires mid-count (W1-06 × W1-04)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a 401 opens the re-auth sheet (no retry callback), keeps the row on the phone, and pauses auto-retries until sign-in', async () => {
    const onExpired = vi.fn();
    const gate = createAuthGate(onExpired);
    let signedIn = false;
    const send = vi.fn(async () => {
      if (!signedIn) throw unauthorized();
      return {};
    });
    const box = createLineOutbox({ send: gate.wrap(send), isNetworkError: isTransientFailure });
    box.set(row('a', 8));
    await vi.advanceTimersByTimeAsync(300);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(box.states().a).toBe('queued');
    expect(gate.blocked).toBe(true);
    // The 15 s / online retry is held while signed out (no sheet re-opening every 15 s).
    expect(gate.shouldAutoRetry()).toBe(false);
    signedIn = true;
    gate.resume();
    expect(gate.shouldAutoRetry()).toBe(true);
    await box.retry();
    expect(box.states().a).toBe('saved');
  });

  it('a dropped network or a branch switch is not an expired session', () => {
    expect(isSessionExpired(new TypeError('Failed to fetch'))).toBe(false);
    expect(isSessionExpired(new ScopeChangedError())).toBe(false);
    expect(isSessionExpired(Object.assign(new Error('x'), { data: { httpStatus: 400, code: 'BAD_REQUEST' } }))).toBe(false);
    expect(isSessionExpired(unauthorized())).toBe(true);
    expect(isSessionExpired(new SessionGoneError())).toBe(true);
  });

  it('a network failure leaves the gate open (the offline note, not the sign-in sheet)', async () => {
    const onExpired = vi.fn();
    const gate = createAuthGate(onExpired);
    const box = createLineOutbox({ send: gate.wrap(async () => Promise.reject(new TypeError('Failed to fetch'))), isNetworkError: isTransientFailure });
    box.set(row('a', 3));
    await vi.advanceTimersByTimeAsync(300);
    expect(box.states().a).toBe('queued');
    expect(onExpired).not.toHaveBeenCalled();
    expect(gate.shouldAutoRetry()).toBe(true);
  });
});
