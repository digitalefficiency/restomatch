import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/healthz — the uptime probes (docs/MONITORING.md U1/U3). The base probe
 * never touches the database; ?jobs=1 adds the job runner's heartbeat age.
 */
const readHeartbeatRaw = vi.fn<() => Promise<string | null>>();
vi.mock('@/lib/workerHeartbeatStore', () => ({ readHeartbeatRaw: () => readHeartbeatRaw() }));

const { GET } = await import('../route');
const { JOBS_FRESH_SEC, jobsReportFromRaw } = await import('../jobs');

const call = async (path: string) => {
  const res = await GET(new Request(`https://app.test${path}`));
  return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as Record<string, unknown> };
};
const beatAgo = (sec: number) =>
  JSON.stringify({ at: new Date(Date.now() - sec * 1000).toISOString(), host: 'vercel-cron', pid: 1, workers: 1 });

afterEach(() => {
  readHeartbeatRaw.mockReset();
  vi.restoreAllMocks();
});

describe('/api/healthz', () => {
  it('base probe: unchanged shape, and never reads the database', async () => {
    const r = await call('/api/healthz');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['commit', 'service', 'status', 'time']);
    expect(r.body).toMatchObject({ status: 'ok', service: 'restomatch-web' });
    expect(readHeartbeatRaw).not.toHaveBeenCalled();
  });

  it('?jobs=1 with a fresh beat → jobs "ok" + age, no-store', async () => {
    readHeartbeatRaw.mockResolvedValue(beatAgo(42));
    const r = await call('/api/healthz?jobs=1');
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(r.body).toMatchObject({ status: 'ok', jobs: 'ok' });
    expect(r.body.heartbeatAgeSec).toBeGreaterThanOrEqual(41);
    expect(r.body.heartbeatAgeSec).toBeLessThanOrEqual(44);
    expect(r.body).not.toHaveProperty('host'); // nothing about the runner leaves the server but the age
  });

  it(`?jobs=1 with a beat ≥ ${JOBS_FRESH_SEC} s old → jobs "stale"`, async () => {
    readHeartbeatRaw.mockResolvedValue(beatAgo(JOBS_FRESH_SEC + 5));
    const r = await call('/api/healthz?jobs=1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', jobs: 'stale' });
    expect(r.body.heartbeatAgeSec).toBeGreaterThanOrEqual(JOBS_FRESH_SEC);
  });

  it('?jobs=1 with no heartbeat row at all → jobs "stale", age null', async () => {
    readHeartbeatRaw.mockResolvedValue(null);
    const r = await call('/api/healthz?jobs=1');
    expect(r.body).toMatchObject({ status: 'ok', jobs: 'stale', heartbeatAgeSec: null });
  });

  it('?jobs=1 when the database errors → jobs "unknown" with HTTP 200', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    readHeartbeatRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const r = await call('/api/healthz?jobs=1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'ok', jobs: 'unknown', heartbeatAgeSec: null });
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNREFUSED/); // no internals in the public answer
  });

  it('?jobs=1 when the database hangs → jobs "unknown" within the deadline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    readHeartbeatRaw.mockReturnValue(new Promise(() => {}));
    const t0 = Date.now();
    const r = await call('/api/healthz?jobs=1');
    expect(r.body).toMatchObject({ jobs: 'unknown' });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('only jobs=1 turns the check on', async () => {
    const r = await call('/api/healthz?jobs=0');
    expect(r.body).not.toHaveProperty('jobs');
    expect(readHeartbeatRaw).not.toHaveBeenCalled();
  });
});

describe('jobsReportFromRaw (pure)', () => {
  const now = Date.parse('2026-11-08T07:00:00Z');
  const raw = (iso: string) => JSON.stringify({ at: iso });
  it('the 180 s edge: 179 s ok, 180 s stale', () => {
    expect(jobsReportFromRaw(raw('2026-11-08T06:57:01Z'), now)).toEqual({ jobs: 'ok', heartbeatAgeSec: 179 });
    expect(jobsReportFromRaw(raw('2026-11-08T06:57:00Z'), now)).toEqual({ jobs: 'stale', heartbeatAgeSec: 180 });
  });
  it('no row → stale; an unreadable row → unknown', () => {
    expect(jobsReportFromRaw(null, now)).toEqual({ jobs: 'stale', heartbeatAgeSec: null });
    expect(jobsReportFromRaw('not json', now)).toEqual({ jobs: 'unknown', heartbeatAgeSec: null });
    expect(jobsReportFromRaw(raw('yesterday'), now)).toEqual({ jobs: 'unknown', heartbeatAgeSec: null });
  });
});
