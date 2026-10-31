/** /api/cron/jobs: claims stop after this long; maxDuration (300 s) leaves the rest for the last job. */
export const JOBS_BUDGET_MS = 240_000;

/** The worker_heartbeats row (worker_id + host) the cron runner beats under. */
export const JOBS_HEARTBEAT_HOST = 'vercel-cron';
