/**
 * /api/cron/jobs: claims stop after this long; maxDuration (300 s) leaves the
 * rest for the last job.
 *
 * Why 240 s stays (OCR-A PR-OCR-3): the route runs on Vercel's 300 s ceiling.
 * Claims stop at 240 s, so a short job (match, outbox, reports — seconds) claimed
 * at the very end still has 60 s to finish. A Claude OCR read is longer and paid,
 * so the runner claims ocr-invoice only while OCR_JOB_HEADROOM_MS (default 120 s)
 * of this claim window is left — i.e. in the first 120 s of a tick — which gives
 * the latest OCR job 120 s + 60 s = 180 s before the function is cut off. A
 * shorter budget would starve the queue; a longer one would cut short jobs off
 * at maxDuration, where they stall and are retried.
 */
export const JOBS_BUDGET_MS = 240_000;

/** The worker_heartbeats row (worker_id + host) the cron runner beats under. */
export const JOBS_HEARTBEAT_HOST = 'vercel-cron';
