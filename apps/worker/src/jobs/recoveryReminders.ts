/**
 * recovery-reminders — 08:30 IL daily (flag `recovery`, AU-03 / A12): one digest
 * per owner / manager (+ bookkeeper, opt-in) of credit requests with no credit
 * invoice MORE than CLAIM_ANSWER_DAYS (7) whole Israel days after the letter (or
 * the claim) — the one predicate of packages/api recovery/overdue.ts. Detection
 * only: the e-mails go through the outbox (enqueueRecoveryReminders) and
 * outbox-dispatch; nothing is ever sent to a supplier (each line links to a
 * click-only draft).
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
