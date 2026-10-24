import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyEnqueued, setEnqueueListener } from '@restomatch/queue';
import { __resetJobKicks, KICK_BUDGET_MS, kickQueue, registerJobKick } from '../jobKick';

/**
 * The after() kick (serverless jobs). Outside a request scope Next's after()
 * throws: the kick must swallow that and run nothing (the job stays queued for
 * the cron route). Inside one, a burst of enqueues schedules ONE run per queue.
 */
afterEach(() => {
  setEnqueueListener(null);
  __resetJobKicks();
  vi.unstubAllEnvs();
});

describe('outside a request scope', () => {
  it("the real after() throws there — the kick is a no-op: no runner, no throw", () => {
    const runner = vi.fn();
    expect(kickQueue('ocr-invoice', undefined, runner)).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it('as the registered enqueue listener it never fails the producer', () => {
    expect(registerJobKick({} as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(() => notifyEnqueued('ocr-invoice')).not.toThrow();
    expect(notifyEnqueued('match-invoice')).toBe('listener');
  });
});

describe('inside a request', () => {
  it('schedules one run per queue; an enqueue during the run makes it look again', async () => {
    const tasks: Array<() => Promise<void>> = [];
    const schedule = (t: () => Promise<void>) => void tasks.push(t);
    const runQueuedJobs = vi.fn(async () => {
      // Another request enqueues while this run is busy (after its last empty claim, say).
      if (runQueuedJobs.mock.calls.length === 1) expect(kickQueue('ocr-invoice', schedule, runner)).toBe(true);
      return { ran: 1, stoppedBy: 'empty' };
    });
    const runner = async () => runQueuedJobs;

    expect(kickQueue('ocr-invoice', schedule, runner)).toBe(true);
    // Enqueued before the run starts: the same run (it claims until empty) covers it.
    expect(kickQueue('ocr-invoice', schedule, runner)).toBe(true);
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    // Once, then once more for the enqueue that arrived while it ran — no second after().
    expect(runQueuedJobs).toHaveBeenCalledTimes(2);
    expect(tasks).toHaveLength(1);
    const first = runQueuedJobs.mock.calls[0] as unknown as [{ budgetMs: number; queues: string[] }];
    expect(first[0].queues).toEqual(['ocr-invoice']);
    expect(first[0].budgetMs).toBeLessThanOrEqual(KICK_BUDGET_MS);
    expect(first[0].budgetMs).toBeGreaterThan(KICK_BUDGET_MS - 5_000);
    // Finished: the next enqueue schedules a new run.
    expect(kickQueue('ocr-invoice', schedule, runner)).toBe(true);
    expect(tasks).toHaveLength(2);
  });

  it('only the queues a user waits on (OCR, match, catalog import) are kicked', () => {
    const schedule = vi.fn();
    for (const q of ['outbox-dispatch', 'baselines', 'daily-expectations']) expect(kickQueue(q, schedule)).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
    for (const q of ['ocr-invoice', 'match-invoice', 'import-catalog']) expect(kickQueue(q, schedule)).toBe(true);
    expect(schedule).toHaveBeenCalledTimes(3);
  });

  it('a failing run is logged, never thrown, and frees the queue for the next kick', async () => {
    const tasks: Array<() => Promise<void>> = [];
    const schedule = (t: () => Promise<void>) => void tasks.push(t);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = async () => async () => {
      throw new Error('db down');
    };
    expect(kickQueue('match-invoice', schedule, runner)).toBe(true);
    await expect(tasks[0]!()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('kick match-invoice failed: db down'));
    expect(kickQueue('match-invoice', schedule, runner)).toBe(true);
    expect(tasks).toHaveLength(2);
    error.mockRestore();
  });

  it('JOB_KICK=off: no listener (the cron route still runs everything)', () => {
    expect(registerJobKick({ JOB_KICK: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(notifyEnqueued('ocr-invoice')).toBe('none');
  });
});
