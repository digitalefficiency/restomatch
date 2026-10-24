import { describe, expect, it, vi } from 'vitest';
import { registerCronSchedules } from '../cron';
import { isCronSkipped, parseCronSkip, unknownCronSkipNames } from '../cronSkip';
import { registeredSchedules } from '../queue';

/**
 * SERVERLESS_CRON_SKIP — the operational pause for the serverless runner's
 * scheduled tasks (next to JOB_KICK). Default: nothing is skipped.
 */
const recovery = { id: 'recovery-reminders-0830', queue: 'recovery-reminders' };
const outbox = { id: 'outbox-dispatch-60s', queue: 'outbox-dispatch' };

describe('parseCronSkip / isCronSkipped', () => {
  it('unset, empty or only separators: nothing is skipped', () => {
    for (const raw of [undefined, '', '  ', ',', ' , ,']) {
      expect(parseCronSkip(raw)).toBeNull();
      expect(isCronSkipped(parseCronSkip(raw), recovery)).toBe(false);
    }
  });

  it('`all` skips every task (any case, among other names too)', () => {
    for (const raw of ['all', ' ALL ', 'price-alerts-07,all']) {
      const skip = parseCronSkip(raw);
      expect(skip?.all).toBe(true);
      expect(isCronSkipped(skip, recovery)).toBe(true);
      expect(isCronSkipped(skip, outbox)).toBe(true);
    }
  });

  it('a list names tasks by cron.ts id or by queue; spaces and case are ignored; others still run', () => {
    const byId = parseCronSkip(' Recovery-Reminders-0830 , price-alerts-07');
    expect(isCronSkipped(byId, recovery)).toBe(true);
    expect(isCronSkipped(byId, { id: 'price-alerts-07', queue: 'price-alerts' })).toBe(true);
    expect(isCronSkipped(byId, outbox)).toBe(false);
    const byQueue = parseCronSkip('outbox-dispatch');
    expect(isCronSkipped(byQueue, outbox)).toBe(true);
    expect(isCronSkipped(byQueue, recovery)).toBe(false);
  });

  it('names no registered cron.ts task matches are reported (a typo must not pause nothing silently)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await registerCronSchedules();
    const tasks = registeredSchedules();
    expect(tasks).toEqual(expect.arrayContaining([recovery, outbox]));
    expect(unknownCronSkipNames(parseCronSkip('recovery-reminders-0830,outbox-dispatch,all'), tasks)).toEqual([]);
    expect(unknownCronSkipNames(parseCronSkip('recovery-reminder-0830, outbox'), tasks)).toEqual(['recovery-reminder-0830', 'outbox']);
    expect(unknownCronSkipNames(null, tasks)).toEqual([]);
  });
});
