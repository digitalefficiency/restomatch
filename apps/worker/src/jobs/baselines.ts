import { makeWorker } from '../queue';

export interface BaselinesJob {
  restaurantId: string;
  windowDays: number;
}

export function startBaselinesWorker() {
  return makeWorker<BaselinesJob>('baselines', async (job) => {
    console.log('[baselines] TODO compute P50/P90', job.data);
    return { ok: true };
  });
}
