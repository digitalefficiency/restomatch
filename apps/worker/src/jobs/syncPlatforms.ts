import { makeWorker } from '../queue.js';

export interface SyncPlatformsJob {
  restaurantId: string;
  platform: string;
}

export function startSyncPlatformsWorker() {
  return makeWorker<SyncPlatformsJob>('sync-platforms', async (job) => {
    console.log('[sync-platforms] TODO', job.data);
    return { ok: true };
  });
}
