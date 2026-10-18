import { computeBaselines } from '@restomatch/charts';
import { createDb, eq, restaurants } from '@restomatch/db';
import { makeWorker } from '../queue';

export interface BaselinesJob {
  /** When omitted, computes for ALL restaurants. */
  restaurantId?: string;
  windowDays?: number;
  minSamples?: number;
}

export function startBaselinesWorker() {
  return makeWorker<BaselinesJob>('baselines', async (job) => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    const db = createDb(url);

    const targets = job.data.restaurantId
      ? await db.select().from(restaurants).where(eq(restaurants.id, job.data.restaurantId))
      : await db.select().from(restaurants);

    const summary: Array<{ restaurantId: string; baselineCount: number }> = [];

    for (const r of targets) {
      const baselines = await computeBaselines(db, r.id, {
        windowDays: job.data.windowDays,
        minSamples: job.data.minSamples,
      });
      summary.push({ restaurantId: r.id, baselineCount: baselines.length });
    }

    console.log(
      `[baselines] restaurants=${summary.length} ` +
        `total=${summary.reduce((s, r) => s + r.baselineCount, 0)}`,
    );

    return summary;
  });
}
