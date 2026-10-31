import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyEnqueued, setEnqueueListener } from '@restomatch/queue';
import {
  __resetJobKicks,
  JOB_HEADROOM_MS,
  KICK_BUDGET_MS,
  kickInvocationEnd,
  kickQueue,
  PLATFORM_MAX_DURATION_MS,
  registerJobKick,
  withKickBudget,
} from '../jobKick';

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

describe('the kick fits inside the invocation (after() time counts toward maxDuration)', () => {
  /** A fake runner: each claimed job takes `jobMs` on the fake clock; it claims while its budget lasts. */
  function fakeRun(clock: { t: number }, jobs: { left: number }, jobMs: number) {
    return vi.fn(async ({ budgetMs }: { budgetMs: number; queues: string[] }) => {
      const stopAt = clock.t + budgetMs;
      let ran = 0;
      while (jobs.left > 0 && clock.t < stopAt) {
        clock.t += jobMs; // claimed before stopAt; a running job is always finished
        jobs.left -= 1;
        ran += 1;
      }
      return { ran, stoppedBy: jobs.left > 0 ? 'budget' : 'empty' };
    });
  }

  it('the claim deadline is fixed at the enqueue: time before after() starts is deducted', async () => {
    const clock = { t: 0 };
    const now = () => clock.t;
    const tasks: Array<() => Promise<void>> = [];
    const run = fakeRun(clock, { left: 0 }, 0);
    expect(kickQueue('ocr-invoice', (t) => void tasks.push(t), async () => run, now)).toBe(true);
    clock.t = 20_000; // the response took 20 s more before after() ran
    await tasks[0]!();
    expect(run.mock.calls[0]![0].budgetMs).toBe(KICK_BUDGET_MS - 20_000);
  });

  it('a 60 s ingest webhook: 3 jobs of 30 s, response at 3 s — claims one, ends before 60 s, the rest stay queued', async () => {
    // The reviewer's probe: with a fixed 50 s claim budget this ran 2 jobs and ended at 63 s (killed mid-job).
    // (OCR itself is no longer kicked from a 60 s route — OCR_JOB_HEADROOM_MS, below; the budget
    // mechanics are the same for every kicked queue.)
    const clock = { t: 0 };
    const now = () => clock.t;
    const tasks: Array<() => Promise<void>> = [];
    const jobs = { left: 3 };
    const run = fakeRun(clock, jobs, 30_000);
    await withKickBudget(
      60,
      async () => {
        clock.t = 3_000; // parsed, stored, enqueued
        expect(kickQueue('import-catalog', (t) => void tasks.push(t), async () => run, now)).toBe(true);
      },
      now,
    );
    await tasks[0]!();
    expect(run.mock.calls[0]![0].budgetMs).toBe(60_000 - JOB_HEADROOM_MS - 3_000);
    expect(clock.t).toBeLessThanOrEqual(60_000);
    expect(jobs.left).toBe(2); // /api/cron/jobs runs them within a minute
  });

  it('no room left in the route budget: no kick at all (the cron route runs the job)', async () => {
    const clock = { t: 0 };
    const now = () => clock.t;
    const schedule = vi.fn();
    await withKickBudget(
      60,
      async () => {
        clock.t = 60_000 - JOB_HEADROOM_MS; // a slow webhook: a 45 s job would no longer fit
        expect(kickQueue('ocr-invoice', schedule, async () => fakeRun(clock, { left: 1 }, 1), now)).toBe(false);
      },
      now,
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  it('a live kick about to stop claiming does not swallow a new enqueue: a fresh kick is scheduled', async () => {
    const clock = { t: 0 };
    const now = () => clock.t;
    const tasks: Array<() => Promise<void>> = [];
    const schedule = (t: () => Promise<void>) => void tasks.push(t);
    const runner = async () => fakeRun(clock, { left: 0 }, 0);
    // An ingest kick (claims until 15 s) is live …
    await withKickBudget(60, async () => void kickQueue('import-catalog', schedule, runner, now), now);
    expect(tasks).toHaveLength(1);
    // … a photo upload at 1 s is absorbed (14 s of claims left) …
    clock.t = 1_000;
    expect(kickQueue('import-catalog', schedule, runner, now)).toBe(true);
    expect(tasks).toHaveLength(1);
    // … one at 8 s is not (7 s left): it gets its own 50 s kick.
    clock.t = 8_000;
    expect(kickQueue('import-catalog', schedule, runner, now)).toBe(true);
    expect(tasks).toHaveLength(2);
  });

  it('a live kick in the middle of a job does not swallow a new enqueue: the job may end past its claim deadline', async () => {
    // The reviewer's probe: job-1 claimed at 0 s runs 60 s (a slow Claude read; the kick
    // claims until 50 s); job-2 (another tenant) is enqueued at 30 s. Absorbed, it was never
    // claimed by that kick (past its deadline after job-1) and waited for the cron minute.
    const clock = { t: 0 };
    const now = () => clock.t;
    const tasks: Array<() => Promise<void>> = [];
    const schedule = (t: () => Promise<void>) => void tasks.push(t);
    const queued = ['job-1'];
    const ran: string[] = [];
    let release!: () => void;
    const job1Running = new Promise<void>((r) => (release = r));
    let inJob1 = false;
    const run = vi.fn(async ({ budgetMs, onJob }: { budgetMs: number; queues: string[]; onJob?: (running: boolean) => void }) => {
      const stopAt = clock.t + budgetMs;
      let n = 0;
      while (queued.length > 0 && clock.t < stopAt) {
        const job = queued.shift()!;
        onJob?.(true);
        if (job === 'job-1') {
          inJob1 = true;
          await job1Running;
          clock.t += 60_000;
        }
        ran.push(job);
        onJob?.(false);
        n += 1;
      }
      return { ran: n, stoppedBy: queued.length > 0 ? 'budget' : 'empty' };
    });
    const runner = async () => run;

    expect(kickQueue('ocr-invoice', schedule, runner, now)).toBe(true);
    const first = tasks[0]!(); // claims job-1 and is busy with it
    await vi.waitFor(() => expect(inJob1).toBe(true));
    clock.t = 30_000;
    queued.push('job-2');
    expect(kickQueue('ocr-invoice', schedule, runner, now)).toBe(true);
    expect(tasks).toHaveLength(2); // a fresh kick (its own 50 s), not absorbed into the busy one
    await tasks[1]!(); // runs alongside: claims job-2 at once
    expect(ran).toEqual(['job-2']);
    release();
    await first; // job-1 ends at 90 s, past its kick's 50 s: nothing left behind
    expect(ran).toEqual(['job-2', 'job-1']);
    expect(queued).toEqual([]);
  });
});

describe('OCR_JOB_HEADROOM_MS: an OCR read is kicked only with room to finish (OCR-A PR-OCR-3)', () => {
  it('a route on the platform default (300 s): OCR is kicked, and the run is told when the invocation ends', async () => {
    const clock = { t: 1_000 };
    const now = () => clock.t;
    const tasks: Array<() => Promise<void>> = [];
    const run = vi.fn(async (_o: { budgetMs: number; queues: string[]; endsAt?: number }) => ({ ran: 0, stoppedBy: 'empty' }));
    expect(kickQueue('ocr-invoice', (t) => void tasks.push(t), async () => run, now)).toBe(true);
    await tasks[0]!();
    expect(run.mock.calls[0]![0].endsAt).toBe(1_000 + PLATFORM_MAX_DURATION_MS);
  });

  it('a 60 s ingest webhook never kicks OCR (60 s < 120 s headroom): the cron route reads it within a minute', async () => {
    const schedule = vi.fn();
    const now = () => 0;
    await withKickBudget(
      60,
      async () => {
        expect(kickQueue('ocr-invoice', schedule, async () => vi.fn(), now)).toBe(false);
        // Other kicked queues still are (match / catalog import are short).
        expect(kickQueue('match-invoice', schedule, async () => vi.fn(), now)).toBe(true);
      },
      now,
    );
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('the headroom is configurable; a lower value lets a 60 s route kick OCR again', async () => {
    vi.stubEnv('OCR_JOB_HEADROOM_MS', '30000');
    const schedule = vi.fn();
    const now = () => 0;
    await withKickBudget(60, async () => expect(kickQueue('ocr-invoice', schedule, async () => vi.fn(), now)).toBe(true), now);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('late in a 300 s invocation (under 120 s left) OCR is not kicked; with room it is', async () => {
    const clock = { t: 0 };
    const now = () => clock.t;
    const schedule = vi.fn();
    await withKickBudget(
      300,
      async () => {
        clock.t = 200_000; // 100 s before the cut-off: a read may not finish
        expect(kickQueue('ocr-invoice', schedule, async () => vi.fn(), now)).toBe(false);
        clock.t = 150_000; // 150 s left: fits
        expect(kickQueue('ocr-invoice', schedule, async () => vi.fn(), now)).toBe(true);
      },
      now,
    );
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('kickInvocationEnd: the declared route end, else request time + the platform default', async () => {
    expect(kickInvocationEnd(5)).toBe(5 + PLATFORM_MAX_DURATION_MS);
    await withKickBudget(60, async () => expect(kickInvocationEnd(1_000)).toBe(60_000), () => 0);
  });
});
