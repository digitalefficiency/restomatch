import { describe, expect, it, vi } from 'vitest';
import { startDbWatchdog } from '../health';

describe('startDbWatchdog', () => {
  it('calls onDead after N consecutive failed pings, and a success resets the count', async () => {
    vi.useFakeTimers();
    const results = [false, false, true, false, false, false];
    const ping = vi.fn(async () => {
      if (!results.shift()) throw new Error('down');
      return 'PONG';
    });
    const onDead = vi.fn();
    const stop = startDbWatchdog({ ping }, { intervalMs: 1_000, maxFailures: 3, onDead });
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(1_000);
    stop();
    vi.useRealTimers();
    expect(ping).toHaveBeenCalledTimes(6);
    expect(onDead).toHaveBeenCalledTimes(1); // 2 fails, reset, then 3 fails
    expect(onDead).toHaveBeenCalledWith(3);
  });

  it('treats a ping that never answers as a failure', async () => {
    vi.useFakeTimers();
    const onDead = vi.fn();
    const stop = startDbWatchdog({ ping: () => new Promise(() => {}) }, { intervalMs: 1_000, maxFailures: 2, pingTimeoutMs: 100, onDead });
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(1_000);
    stop();
    vi.useRealTimers();
    expect(onDead).toHaveBeenCalled();
  });
});
