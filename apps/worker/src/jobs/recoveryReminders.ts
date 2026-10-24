/**
 * recovery-reminders — 08:30 IL daily (flag `recovery`): chase claims a
 * supplier has not credited 14+ days after the letter. Detection only — the
 * emails go through the outbox (enqueueRecoveryReminders) and outbox-dispatch.
 */
import { enqueueRecoveryReminders } from '@restomatch/api';
import { jobDb } from '../db';
import { makeWorker, type WorkerJob } from '../queue';
import { appBaseUrl } from '../lib/notifyHelpers';

export interface RecoveryRemindersJob {
  restaurantId?: string;
  /** Override "now" (tests). */
  forDate?: string;
}

export function startRecoveryRemindersWorker() {
  return makeWorker<RecoveryRemindersJob>('recovery-reminders', processRecoveryReminders);
}

/** The recovery-reminders job: run by the worker loop (above) and by the serverless runner (handlers.ts). */
export async function processRecoveryReminders(job: WorkerJob<RecoveryRemindersJob>) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const res = await enqueueRecoveryReminders(jobDb(url), {
    restaurantId: job.data.restaurantId,
    now: job.data.forDate ? new Date(job.data.forDate) : new Date(),
    appUrl: appBaseUrl(),
  });
  console.log(`[recovery-reminders] restaurants=${res.restaurants} emails=${res.emails} claims=${res.claims} failed=${res.failed.length}`);
  return res;
}
