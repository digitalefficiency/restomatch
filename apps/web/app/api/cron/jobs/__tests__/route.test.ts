import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/cron/jobs — the serverless job runner's door. Auth exactly like
 * /api/cron/worker-heartbeat: Bearer $CRON_SECRET or 401 (production refuses
 * everything when CRON_SECRET is unset). The tick itself is the worker
 * package's runServerlessTick (DB-tested in apps/worker serverless.db.test.ts);
 * here it is a stub, so a refused call provably runs nothing.
 */
interface Tick {
  ok: boolean;
  maintenance: string;
  scheduled: string[];
  jobs: { ran: number; done: number; retried: number; failed: number; byQueue: Record<string, number>; stoppedBy: string; ms: number };
  ms: number;
}
const { tick } = vi.hoisted(() => ({
  tick: vi.fn(
    async (): Promise<Tick> => ({
      ok: true,
      maintenance: 'ok',
      scheduled: ['outbox-dispatch-60s'],
      jobs: { ran: 2, done: 2, retried: 0, failed: 0, byQueue: { 'outbox-dispatch': 1, 'ocr-sweep': 1 }, stoppedBy: 'empty', ms: 12 },
      ms: 20,
    }),
  ),
}));
vi.mock('@restomatch/worker/serverless', () => ({ runServerlessTick: tick }));

import { queueDbUrl } from '@restomatch/queue';
import { ownerDbUrl } from '@/lib/env';
import * as route from '../route';

const SECRET = 'test-cron-secret-0123456789';
const call = (auth?: string) =>
  route.GET(new Request('http://localhost/api/cron/jobs', { headers: auth === undefined ? {} : { authorization: auth } }));

beforeEach(() => {
  tick.mockClear();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRON_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/cron/jobs auth', () => {
  it('401 without the bearer — nothing runs', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(tick).not.toHaveBeenCalled();
  });

  it('401 with a wrong bearer (or the secret without "Bearer ")', async () => {
    for (const auth of [`Bearer ${SECRET}x`, 'Bearer wrong', SECRET, `bearer ${SECRET}`, `Bearer  ${SECRET}`]) {
      expect((await call(auth)).status, auth).toBe(401);
    }
    expect(tick).not.toHaveBeenCalled();
  });

  it('401 in production when CRON_SECRET is not configured at all', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
  });

  it('the right bearer runs one tick (240 s budget, heartbeat as vercel-cron) and returns the counts', async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick).toHaveBeenCalledWith({ budgetMs: 240_000, heartbeatHost: 'vercel-cron' });
    expect(await res.json()).toMatchObject({
      ok: true,
      scheduled: ['outbox-dispatch-60s'],
      ran: 2,
      done: 2,
      failed: 0,
      byQueue: { 'outbox-dispatch': 1, 'ocr-sweep': 1 },
      stoppedBy: 'empty',
    });
  });

  it('outside production with no CRON_SECRET the check is skipped (local dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CRON_SECRET', '');
    expect((await call()).status).toBe(200);
  });

  it('a tick that reports a failure answers 500 (Vercel shows the cron as failed)', async () => {
    tick.mockResolvedValueOnce({
      ok: false,
      maintenance: 'maintenance failed: x',
      scheduled: [],
      jobs: { ran: 0, done: 0, retried: 0, failed: 0, byQueue: {}, stoppedBy: 'error', ms: 1 },
      ms: 2,
    });
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500);
  });
});

describe('/api/cron/jobs database URL', () => {
  it('a DATABASE_URL beyond repair: the runner gets the repaired owner URL (POSTGRES_URL), not the raw value', async () => {
    // Production on 2026-10-24: DATABASE_URL unusable, the Supabase integration's POSTGRES_URL fine.
    const owner = process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/restomatch_test';
    vi.stubEnv('DATABASE_URL', 'just-a-password');
    vi.stubEnv('POSTGRES_URL', owner);
    vi.stubEnv('QUEUE_DATABASE_URL', '');
    let seen: { db?: string; queue: string | null } | null = null;
    tick.mockImplementationOnce(async () => {
      seen = { db: process.env.DATABASE_URL, queue: queueDbUrl() };
      return { ok: true, maintenance: 'ok', scheduled: [], jobs: { ran: 0, done: 0, retried: 0, failed: 0, byQueue: {}, stoppedBy: 'empty', ms: 1 }, ms: 1 };
    });
    expect((await call(`Bearer ${SECRET}`)).status).toBe(200);
    const repaired = ownerDbUrl({ POSTGRES_URL: owner } as unknown as NodeJS.ProcessEnv);
    expect(repaired).toBeTruthy();
    expect(seen).toEqual({ db: repaired, queue: repaired });
  });
});

describe('/api/cron/jobs deployment config', () => {
  it('Node runtime, never cached, 300 s max duration', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(300);
  });

  it('vercel.json calls it every minute, next to the heartbeat cron, in hnd1', () => {
    const cfg = JSON.parse(readFileSync(new URL('../../../../../vercel.json', import.meta.url), 'utf8')) as {
      regions: string[];
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(cfg.regions).toEqual(['hnd1']);
    expect(cfg.crons).toEqual(
      expect.arrayContaining([
        { path: '/api/cron/jobs', schedule: '* * * * *' },
        { path: '/api/cron/worker-heartbeat', schedule: '*/5 * * * *' },
      ]),
    );
  });
});
