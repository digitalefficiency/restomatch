import { createDb } from '@restomatch/db';
import { runRetention } from '@restomatch/api';
import { makeWorker } from '../queue';

/**
 * Retention / data-minimization purge (E.8 — Amendment 13).
 *
 * Two safety flags, BOTH default-off:
 *   • RETENTION_CRON_ENABLED=1 — registers the daily scheduler (see cron.ts).
 *     Without it the job never fires on its own.
 *   • RETENTION_PURGE_ENABLED=1 — actually DELETES. Without it every run is a
 *     dry-run that only logs what WOULD be removed (zero destruction).
 *
 * So the steady state is: visibility first (dry-run report), destruction only
 * after an operator explicitly opts in. The purge logic itself lives in
 * @restomatch/api (runRetention) and is DB-tested there.
 */
export interface RetentionJob {
  /** Force a dry-run regardless of env (used by ops to preview). */
  dryRun?: boolean;
}

export function isPurgeEnabled(): boolean {
  return process.env.RETENTION_PURGE_ENABLED === '1';
}

export function startRetentionWorker() {
  return makeWorker<RetentionJob>('retention', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    // Dry-run unless the purge flag is explicitly set AND the job didn't force
    // a preview.
    const dryRun = job.data.dryRun === true || !isPurgeEnabled();
    const report = await runRetention(db, { dryRun });

    console.log(
      `[retention] dryRun=${report.dryRun} ` +
        `expiredTokens=${report.expiredVerificationTokens} ` +
        `unsubscribedLeads=${report.unsubscribedLeads} ` +
        `staleLeads=${report.staleLeads}`,
    );

    return report;
  });
}
