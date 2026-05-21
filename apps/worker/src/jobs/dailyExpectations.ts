import { makeWorker } from '../queue.js';

export interface DailyExpectationsJob {
  restaurantId: string;
  forDate: string;
}

export function startDailyExpectationsWorker() {
  return makeWorker<DailyExpectationsJob>('daily-expectations', async (job) => {
    console.log('[daily-expectations] TODO compute today expectations', job.data);
    return { ok: true };
  });
}
