import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  and,
  asc,
  createDb,
  desc,
  discrepancies,
  eq,
  grLines,
  invoices,
  matchRuns,
  memberships,
  poLines,
  purchaseOrders,
  restaurants,
  sql,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '@restomatch/api';
import { computeLeakHero } from '@restomatch/charts';
import { mulIls, toAgorot } from '@restomatch/matching';
import { insertJob, queueSql } from '@restomatch/queue';
import { registerCronSchedules } from '../cron';
import { JOB_HANDLERS, type JobProcessor } from '../handlers';
import { makeWorker, type WorkerJob } from '../queue';
import { runDueSchedules, runQueuedJobs, runServerlessTick } from '../serverless';

/**
 * Serverless job execution (no worker process): the web app's runner claims and
 * runs the worker's own processors.
 *
 *  (a) the receiving photo beat: registerInvoice enqueues the OCR job (dev stub
 *      provider), runQueuedJobs runs it AND the match job it enqueues — in the same
 *      run — and the leak hero moves by exactly the one PRICE_HIGHER the stub bills;
 *  (b) two runners in parallel never run a job twice (and never two jobs of one
 *      queue + tenant at once); retry / dead-letter like the worker;
 *  (d) schedules: a daily task once per Israel day, the outbox every minute — the
 *      job row is the marker; the cron tick beats the heartbeat.
 * Demo seed (DEMO_TODAY 2026-10-25), like ocrSweepReceipt.db.test.ts.
 */
process.env.DATABASE_URL ??= testDbUrl();
const db = createDb(testDbUrl());
const qsql = queueSql(testDbUrl());
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let restaurantId = '';
let receiverId = '';
let hasharon = '';

const caller = () =>
  appRouter.createCaller({ db, session: { userId: receiverId, restaurantId, role: 'receiver' } } as never);
const heroAgorot = async () => Math.round((await computeLeakHero(db, restaurantId, { now: new Date() })).leakIls * 100);
const ag = (n: number) => Math.round(n * 100);

/** A fresh HaSharon PO due an hour ago with the first `n` lines of the supplier's latest PO. */
async function freshPo(n: number): Promise<{ poId: string; lines: Array<{ qty: number; price: number }> }> {
  const [src] = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.restaurantId, restaurantId), eq(purchaseOrders.supplierId, hasharon)))
    .orderBy(desc(purchaseOrders.expectedDeliveryAt))
    .limit(1);
  const lines = (await db.select().from(poLines).where(eq(poLines.poId, src!.id)).orderBy(asc(poLines.id))).slice(0, n);
  const [po] = await db
    .insert(purchaseOrders)
    .values({
      restaurantId,
      supplierId: hasharon,
      expectedDeliveryAt: new Date(Date.now() - 3600_000),
      status: 'sent',
      source: 'manual',
      notes: 'serverless runner test',
    })
    .returning();
  await db.insert(poLines).values(
    lines.map((l) => ({
      poId: po!.id,
      productId: l.productId,
      rawDescription: l.rawDescription,
      rawDescriptionEn: l.rawDescriptionEn,
      qtyOrdered: l.qtyOrdered,
      unit: l.unit,
      unitPriceExpected: l.unitPriceExpected,
    })),
  );
  // The NEW PO's lines in the order the dev OCR stub reads them (by id — random
  // UUIDs, so not the source PO's order): lines[0] is the line it bills +8%.
  const created = await db.select().from(poLines).where(eq(poLines.poId, po!.id)).orderBy(asc(poLines.id));
  return { poId: po!.id, lines: created.map((l) => ({ qty: Number(l.qtyOrdered), price: Number(l.unitPriceExpected) })) };
}

beforeAll(async () => {
  for (const [pkg, script] of [
    ['@restomatch/db', 'scripts/seed.ts'],
    ['@restomatch/worker', 'scripts/seed-demo.ts'],
  ] as const) {
    const run = spawnSync('pnpm', ['--filter', pkg, 'exec', 'tsx', script], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: testDbUrl(), DEMO_TODAY: '2026-10-25' },
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(`demo seed (${script}) failed:\n${run.stdout}\n${run.stderr}`);
  }
  await qsql`DELETE FROM job_queue`;
  await qsql`DELETE FROM ops_kv WHERE starts_with(key, 'cron:')`;
  await qsql`DELETE FROM worker_heartbeats`;
  const [r] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.name, 'כפר הזיתים')).limit(1);
  restaurantId = r!.id;
  const [m] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.restaurantId, restaurantId), eq(memberships.role, 'receiver')))
    .limit(1);
  receiverId = m!.userId;
  const [s] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.nameEn, 'HaSharon Produce')))
    .limit(1);
  hasharon = s!.id;
  // The dev OCR stub (deterministic read of the PO, line 1 billed +8%) — never a real Claude call.
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}, 300_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await db.execute(sql`TRUNCATE restaurants, users RESTART IDENTITY CASCADE`);
  await qsql`DELETE FROM job_queue`;
  await qsql`DELETE FROM ops_kv WHERE starts_with(key, 'cron:')`;
  await qsql`DELETE FROM worker_heartbeats`;
});

describe('(a) photo → OCR → match, run by the serverless runner (no worker)', () => {
  it('the OCR job and the match job it enqueues run in ONE run; the hero moves by exactly one PRICE_HIGHER', async () => {
    // Two lines: the stub bills line 1 at +8% and (with only two lines) nothing else differently.
    const { poId, lines } = await freshPo(2);
    expect(lines).toHaveLength(2);
    const gr = (await caller().receiving.startReceipt({ poId })).receiptId;
    const counted = await db.select({ id: grLines.id, poLineId: grLines.poLineId }).from(grLines).where(eq(grLines.grId, gr));
    const ordered = await db.select({ id: poLines.id, qty: poLines.qtyOrdered }).from(poLines).where(eq(poLines.poId, poId));
    for (const l of counted) {
      const qty = Number(ordered.find((o) => o.id === l.poLineId)!.qty);
      await caller().receiving.markGrLine({ grLineId: l.id, qtyReceived: qty });
    }
    await caller().receiving.submitReceipt({ grId: gr });
    expect(await runQueuedJobs({ budgetMs: 30_000 })).toMatchObject({ ran: 0, stoppedBy: 'empty' });
    const before = await heroAgorot();

    // The receiver photographs the invoice: the request enqueues ONE job (ocr-invoice).
    const reg = await caller().receiving.registerInvoice({
      grId: gr,
      supplierId: hasharon,
      imageUrl: `https://local.test/invoice-scans/${gr}-serverless.jpg`,
    });
    expect(reg).toMatchObject({ ocrQueued: true });
    const queued = await qsql<Array<{ queue: string }>>`SELECT queue FROM job_queue WHERE status = 'queued'`;
    expect(queued.map((j) => j.queue)).toEqual(['ocr-invoice']);

    // The after() kick runs only the OCR queue; the match job joins the run.
    const run = await runQueuedJobs({ budgetMs: 60_000, queues: ['ocr-invoice'] });
    expect(run).toMatchObject({ ran: 2, done: 2, failed: 0, stoppedBy: 'empty', byQueue: { 'ocr-invoice': 1, 'match-invoice': 1 } });
    const jobs = await qsql<Array<{ queue: string; status: string; finished_at: Date }>>`
      SELECT queue, status, finished_at FROM job_queue ORDER BY id`;
    expect(jobs.map((j) => [j.queue, j.status])).toEqual([
      ['ocr-invoice', 'done'],
      ['match-invoice', 'done'],
    ]);
    expect(jobs[1]!.finished_at.getTime()).toBeGreaterThanOrEqual(jobs[0]!.finished_at.getTime());

    // Exactly one finding: line 1's price, +8% of the agreed price × the billed quantity.
    const runs = await db.select({ id: matchRuns.id, poId: matchRuns.poId, grId: matchRuns.grId }).from(matchRuns).where(eq(matchRuns.invoiceId, reg.invoiceId));
    expect(runs).toEqual([{ id: runs[0]!.id, poId, grId: gr }]);
    const found = await db
      .select({ type: discrepancies.type, delta: discrepancies.deltaAmount, severity: discrepancies.severity })
      .from(discrepancies)
      .where(eq(discrepancies.matchRunId, runs[0]!.id));
    expect(found.map((d) => d.type)).toEqual(['PRICE_HIGHER']);
    // The engine's own arithmetic: (billed − agreed) × billed qty, quantized once (mulIls).
    const { qty, price } = lines[0]!;
    const expectedAg = toAgorot(mulIls(Math.round(price * 1.08 * 100) / 100 - price, qty));
    expect(ag(Number(found[0]!.delta))).toBe(expectedAg);
    expect(expectedAg).toBeGreaterThan(0);

    // The hero: + exactly that PRICE_HIGHER, to the agora.
    expect((await heroAgorot()) - before).toBe(expectedAg);
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, reg.invoiceId));
    expect(inv!.status).not.toBe('ocr_pending');
  });
});

describe('(b) runner semantics', () => {
  const Q = 'serverless-test';
  const handlers = JOB_HANDLERS as Record<string, JobProcessor>;
  afterAll(() => {
    delete handlers[Q];
  });

  it('two runners in parallel never run the same job twice (nor two of one tenant at once)', async () => {
    const extra = await db
      .insert(restaurants)
      .values([{ name: 'serverless test A' }, { name: 'serverless test B' }])
      .returning({ id: restaurants.id });
    const tenants = [restaurantId, ...extra.map((r) => r.id)];
    const ids: string[] = [];
    for (let i = 0; i < 24; i++) {
      const job = await insertJob(qsql, Q, { n: i }, { restaurantId: tenants[i % 3]! });
      ids.push(job!.id);
    }
    for (let i = 0; i < 4; i++) ids.push((await insertJob(qsql, Q, { n: 100 + i }))!.id); // all-tenant (NULL) jobs
    const runs = new Map<string, number>();
    const busy = new Map<string, number>();
    let overlap = 0;
    handlers[Q] = (async (job: WorkerJob<{ n: number }>) => {
      runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
      const [row] = await qsql<Array<{ restaurant_id: string | null }>>`SELECT restaurant_id FROM job_queue WHERE id = ${job.id}`;
      const group = row!.restaurant_id ?? 'all';
      busy.set(group, (busy.get(group) ?? 0) + 1);
      if (busy.get(group)! > 1) overlap += 1;
      await new Promise((r) => setTimeout(r, 5));
      busy.set(group, busy.get(group)! - 1);
      return { n: job.data.n };
    }) as JobProcessor;

    const [r1, r2] = await Promise.all([
      runQueuedJobs({ budgetMs: 60_000, queues: [Q], workerId: 'runner-1' }),
      runQueuedJobs({ budgetMs: 60_000, queues: [Q], workerId: 'runner-2' }),
    ]);
    // A runner stops when nothing is claimable FOR IT (its tenants busy elsewhere); drain the rest.
    const r3 = await runQueuedJobs({ budgetMs: 60_000, queues: [Q], workerId: 'runner-3' });
    expect(r1.ran + r2.ran + r3.ran).toBe(ids.length);
    expect([...runs.values()].every((n) => n === 1)).toBe(true);
    expect([...runs.keys()].sort()).toEqual([...ids].sort());
    expect(overlap).toBe(0);
    const rows = await qsql<Array<{ status: string; attempts: number; result: { n: number } }>>`
      SELECT status, attempts, result FROM job_queue WHERE queue = ${Q}`;
    expect(rows.every((r) => r.status === 'done' && r.attempts === 1 && typeof r.result.n === 'number')).toBe(true);
  });

  it('a worker process next to two runners: still one job per queue + tenant at a time, each job once', async () => {
    // The worker's dispatcher claims through claimAnySerial too (it used plain
    // claimAny: the worker could start a job of a tenant a runner was running).
    await qsql`DELETE FROM job_queue WHERE queue = ${Q}`;
    const extra = await db
      .insert(restaurants)
      .values([{ name: 'serverless test C' }, { name: 'serverless test D' }])
      .returning({ id: restaurants.id });
    const tenants = [restaurantId, ...extra.map((r) => r.id)];
    const ids: string[] = [];
    // Uneven tenants and run times, so the claimers do not settle into one tenant each.
    for (let i = 0; i < 30; i++) ids.push((await insertJob(qsql, Q, { n: i }, { restaurantId: tenants[(i * i + i) % 3]! }))!.id);
    for (let i = 0; i < 6; i++) ids.push((await insertJob(qsql, Q, { n: 100 + i }))!.id);
    const runs = new Map<string, number>();
    const busy = new Map<string, string[]>();
    const overlaps: string[] = [];
    const claimers = new Set<string>();
    const processor = (async (job: WorkerJob<{ n: number }>) => {
      runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
      const [row] = await qsql<Array<{ restaurant_id: string | null; locked_by: string }>>`
        SELECT restaurant_id, locked_by FROM job_queue WHERE id = ${job.id}`;
      const group = row!.restaurant_id ?? 'all';
      const by = row!.locked_by.startsWith('runner-') ? row!.locked_by : 'worker';
      claimers.add(by);
      const now = busy.get(group) ?? [];
      if (now.length > 0) overlaps.push(`${group}: ${by} while ${now.join(',')}`);
      busy.set(group, [...now, by]);
      await new Promise((r) => setTimeout(r, 3 + ((job.data.n * 7) % 23)));
      busy.set(group, (busy.get(group) ?? []).filter((_, i, a) => i !== a.indexOf(by)));
      return { n: job.data.n };
    }) as JobProcessor;
    handlers[Q] = processor;

    const worker = makeWorker(Q, processor as never, { pollMs: 5, sql: queueSql(testDbUrl(), 2, 21) });
    try {
      await Promise.all([
        runQueuedJobs({ budgetMs: 60_000, queues: [Q], workerId: 'runner-1', sql: queueSql(testDbUrl(), 2, 22) }),
        runQueuedJobs({ budgetMs: 60_000, queues: [Q], workerId: 'runner-2', sql: queueSql(testDbUrl(), 2, 23) }),
      ]);
      // Runners stop when nothing is claimable for them; the worker drains the rest.
      await vi.waitFor(
        async () => {
          const [left] = await qsql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM job_queue WHERE queue = ${Q} AND status <> 'done'`;
          expect(left!.n).toBe(0);
        },
        { timeout: 30_000, interval: 50 },
      );
    } finally {
      await worker.close();
    }
    expect(overlaps).toEqual([]);
    expect([...runs.keys()].sort()).toEqual([...ids].sort());
    expect([...runs.values()].every((n) => n === 1)).toBe(true);
    expect(claimers.has('worker')).toBe(true);
  });

  it('a failing job is retried with backoff, then dead-lettered — like the worker', async () => {
    await qsql`DELETE FROM job_queue WHERE queue = ${Q}`;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handlers[Q] = (async () => {
      throw new Error('boom');
    }) as JobProcessor;
    const job = await insertJob(qsql, Q, {}, { maxAttempts: 2 });
    expect(await runQueuedJobs({ budgetMs: 10_000, queues: [Q] })).toMatchObject({ ran: 1, retried: 1, failed: 0 });
    const [a] = await qsql<Array<{ status: string; attempts: number; last_error: string; later: boolean }>>`
      SELECT status, attempts, last_error, run_at > now() AS later FROM job_queue WHERE id = ${job!.id}`;
    expect(a).toMatchObject({ status: 'queued', attempts: 1, last_error: 'boom', later: true });
    // Backed off: not claimable now.
    expect(await runQueuedJobs({ budgetMs: 10_000, queues: [Q] })).toMatchObject({ ran: 0, stoppedBy: 'empty' });
    await qsql`UPDATE job_queue SET run_at = now() WHERE id = ${job!.id}`;
    expect(await runQueuedJobs({ budgetMs: 10_000, queues: [Q] })).toMatchObject({ ran: 1, retried: 0, failed: 1 });
    const [b] = await qsql<Array<{ status: string; attempts: number }>>`SELECT status, attempts FROM job_queue WHERE id = ${job!.id}`;
    expect(b).toEqual({ status: 'failed', attempts: 2 });
  });

  it('onJob brackets each job it runs (the after() kick: a busy kick absorbs no new enqueue)', async () => {
    await qsql`DELETE FROM job_queue WHERE queue = ${Q}`;
    const seen: string[] = [];
    handlers[Q] = (async (job: WorkerJob<{ n: number }>) => {
      seen.push(`run ${job.data.n}`);
      if (job.data.n === 2) throw new Error('boom'); // a failing job is bracketed too
      return {};
    }) as JobProcessor;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const n of [1, 2]) await insertJob(qsql, Q, { n }, { maxAttempts: 1 });
    const r = await runQueuedJobs({ budgetMs: 10_000, queues: [Q], onJob: (running) => seen.push(running ? 'start' : 'end') });
    expect(r).toMatchObject({ ran: 2, done: 1, failed: 1 });
    expect(seen).toEqual(['start', 'run 1', 'end', 'start', 'run 2', 'end']);
    await qsql`DELETE FROM job_queue WHERE queue = ${Q}`;
  });

  it('a spent budget claims nothing', async () => {
    handlers[Q] = (async () => ({})) as JobProcessor;
    await insertJob(qsql, Q, {});
    expect(await runQueuedJobs({ budgetMs: 0, queues: [Q] })).toMatchObject({ ran: 0, stoppedBy: 'budget' });
    await qsql`DELETE FROM job_queue WHERE queue = ${Q}`;
  });
});

describe('(d) scheduled tasks: the job row is the per-slot marker', () => {
  // November (no DST change near): Israel = UTC+2, so 06:00:30 IL = 04:00:30Z.
  const at = (iso: string) => new Date(iso);
  const slots = async (queue: string) =>
    (
      await qsql<Array<{ dedupe_key: string }>>`
        SELECT dedupe_key FROM job_queue WHERE queue = ${queue} AND starts_with(dedupe_key, 'cron:') ORDER BY id`
    ).map((r) => r.dedupe_key);

  it('a daily task runs once per Israel day; the outbox once per minute (each call)', async () => {
    await qsql`DELETE FROM job_queue`;
    const day1 = await runDueSchedules(qsql, at('2026-11-10T04:00:30Z')); // 06:00:30 IL
    expect(day1).toEqual(expect.arrayContaining(['daily-expectations-06', 'outbox-dispatch-60s', 'ocr-sweep-5m']));
    const again = await runDueSchedules(qsql, at('2026-11-10T04:01:30Z')); // same IL day, next minute
    expect(again).toContain('outbox-dispatch-60s');
    expect(again).not.toContain('daily-expectations-06');
    const evening = await runDueSchedules(qsql, at('2026-11-10T21:59:30Z')); // 23:59:30 IL, same day
    expect(evening).toContain('outbox-dispatch-60s');
    expect(evening).not.toContain('daily-expectations-06');
    const day2 = await runDueSchedules(qsql, at('2026-11-11T04:00:40Z')); // 06:00 IL the next day
    expect(day2).toEqual(expect.arrayContaining(['daily-expectations-06', 'outbox-dispatch-60s']));

    expect(await slots('daily-expectations')).toEqual([
      'cron:daily-expectations-06:2026-11-10T06:00',
      'cron:daily-expectations-06:2026-11-11T06:00',
    ]);
    expect(await slots('outbox-dispatch')).toEqual([
      'cron:outbox-dispatch-60s:2026-11-10T04:00:00.000Z',
      'cron:outbox-dispatch-60s:2026-11-10T04:01:00.000Z',
      'cron:outbox-dispatch-60s:2026-11-10T21:59:00.000Z',
      'cron:outbox-dispatch-60s:2026-11-11T04:00:00.000Z',
    ]);
    // Another runner (a fresh instance, or a worker process) ticking the same minute adds
    // nothing: re-registering drops this process's memory of the slots it fired, so
    // only the job rows' unique dedupe keys stand between it and a second run.
    await registerCronSchedules();
    expect(await runDueSchedules(qsql, at('2026-11-11T04:00:50Z'))).toEqual([]);
    expect(await slots('daily-expectations')).toHaveLength(2);
  });

  it('SERVERLESS_CRON_SKIP: a skipped task does not fire; its daily slot is marked skipped and not replayed once lifted', async () => {
    await qsql`DELETE FROM job_queue`;
    await registerCronSchedules(); // forget this process's fired slots
    const env = (v?: string) => (v === undefined ? {} : { SERVERLESS_CRON_SKIP: v }) as unknown as NodeJS.ProcessEnv;
    // 06:00:30 IL: daily-expectations is on time, the outbox fires every minute.
    const fired = await runDueSchedules(qsql, at('2026-11-20T04:00:30Z'), env(' daily-expectations-06, outbox-dispatch'));
    expect(fired).not.toContain('daily-expectations-06'); // by task id
    expect(fired).not.toContain('outbox-dispatch-60s'); // by queue name
    expect(fired).toContain('ocr-sweep-5m'); // not named: fires as usual
    const marker = await qsql<Array<{ status: string; result: unknown }>>`
      SELECT status, result FROM job_queue WHERE dedupe_key = 'cron:daily-expectations-06:2026-11-20T06:00'`;
    expect(marker).toEqual([{ status: 'done', result: { skipped: 'SERVERLESS_CRON_SKIP' } }]);
    expect(await slots('outbox-dispatch')).toEqual([]); // every-N: no marker, it just did not fire

    // Lifted a minute later, on a fresh instance (no in-memory slots): the skipped
    // 06:00 slot is NOT caught up; the outbox fires again.
    await registerCronSchedules();
    const lifted = await runDueSchedules(qsql, at('2026-11-20T04:01:30Z'), env());
    expect(lifted).toContain('outbox-dispatch-60s');
    expect(lifted).not.toContain('daily-expectations-06');
    expect(await slots('daily-expectations')).toEqual(['cron:daily-expectations-06:2026-11-20T06:00']);

    // `all`: no scheduled task fires (queued jobs, the kick and the heartbeat are not schedules).
    await registerCronSchedules();
    expect(await runDueSchedules(qsql, at('2026-11-20T04:02:30Z'), env('all'))).toEqual([]);
    expect(await slots('outbox-dispatch')).toEqual(['cron:outbox-dispatch-60s:2026-11-20T04:01:00.000Z']);
  });

  it('the cron tick beats the heartbeat, fires what is due and runs it', async () => {
    await qsql`DELETE FROM job_queue`;
    // 01:30:30 IL: only the every-N schedules are due (no daily slot within its window).
    const tick = await runServerlessTick({ budgetMs: 60_000, heartbeatHost: 'vercel-cron', sql: qsql, now: at('2026-11-12T23:30:30Z') });
    expect(tick.ok).toBe(true);
    expect([...tick.scheduled].sort()).toEqual(['ocr-sweep-5m', 'outbox-dispatch-60s']);
    expect(tick.jobs).toMatchObject({ ran: 2, done: 2, failed: 0, byQueue: { 'outbox-dispatch': 1, 'ocr-sweep': 1 } });
    const [beat] = await qsql<Array<{ worker_id: string; host: string; fresh: boolean }>>`
      SELECT worker_id, host, beat_at > now() - interval '1 minute' AS fresh FROM worker_heartbeats`;
    expect(beat).toEqual({ worker_id: 'vercel-cron', host: 'vercel-cron', fresh: true });
  });
});
