/**
 * SERVERLESS_CRON_SKIP — pause scheduled tasks of the serverless runner
 * (/api/cron/jobs → runDueSchedules) with an env change + redeploy, no code change:
 *
 *   unset / empty   nothing is skipped (the default)
 *   all             every cron.ts task
 *   a,b,…           those tasks, each named by its cron.ts id (`recovery-reminders-0830`)
 *                   or by its queue (`recovery-reminders`); spaces and case are ignored
 *
 * A skipped daily / monthly slot is recorded as done with `{ skipped }` (the job row
 * is the slot's marker), so lifting the switch later does not replay it as a catch-up;
 * a skipped every-N task (outbox-dispatch-60s, ocr-sweep-5m) simply does not fire.
 * Not affected: jobs already queued, the after() kick (uploads: OCR → match), stall
 * recovery and the heartbeat. Only the serverless runner reads it (a worker process
 * keeps every schedule). Pure — no I/O — so it is unit-tested on its own.
 */
export const CRON_SKIP_ENV = 'SERVERLESS_CRON_SKIP';

export interface CronSkip {
  all: boolean;
  /** Lower-cased task ids / queue names. */
  names: ReadonlySet<string>;
}

export interface CronTask {
  id: string;
  queue: string;
}

/** Parse SERVERLESS_CRON_SKIP; null when nothing is skipped. */
export function parseCronSkip(raw: string | undefined): CronSkip | null {
  const names = new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
  if (names.size === 0) return null;
  return { all: names.has('all'), names };
}

/** Is `task` paused by `skip`? */
export function isCronSkipped(skip: CronSkip | null, task: CronTask): boolean {
  if (!skip) return false;
  return skip.all || skip.names.has(task.id.toLowerCase()) || skip.names.has(task.queue.toLowerCase());
}

/** Names in `skip` that match no registered task (a typo would otherwise pause nothing, silently). */
export function unknownCronSkipNames(skip: CronSkip | null, tasks: readonly CronTask[]): string[] {
  if (!skip) return [];
  const known = new Set(['all', ...tasks.flatMap((t) => [t.id.toLowerCase(), t.queue.toLowerCase()])]);
  return [...skip.names].filter((n) => !known.has(n));
}
