import { createServer, type Server } from 'node:http';
import { workerSql } from './queue';

/**
 * Minimal HTTP health server so a platform (Fly.io http_check, Render health
 * check, k8s probe) can verify the worker process is alive and its database
 * (the job queue) answers. The worker is otherwise headless, so without this
 * endpoint the platform crash-loops the machine on a failed probe.
 *
 *   GET /health        → 200 liveness (process is up)
 *   GET /health/ready  → 200 when the database answers `select 1`, else 503
 *
 * Listens on PORT (Fly injects the internal port; defaults to 8080).
 */
export function startHealthServer(workerCount: number): Server {
  const port = Number(process.env.PORT ?? 8080);

  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];

    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', workers: workerCount, uptime: process.uptime() }));
      return;
    }

    if (req.method === 'GET' && url === '/health/ready') {
      void pingDb()
        .then(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ready', db: 'up' }));
        })
        .catch((err: unknown) => {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'not_ready',
              db: 'down',
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'not_found' }));
  });

  server.listen(port, () => {
    console.log(`[worker] health server listening on :${port} (/health, /health/ready)`);
  });

  return server;
}

/** `select 1` on the queue connection. */
export async function pingDb(): Promise<void> {
  await workerSql()`select 1`;
}

/**
 * Self-watchdog (QA wave 1, D1). Platform health checks (Fly's machine checks,
 * Render) do NOT restart a process that is up but useless — e.g. a worker that
 * lost its database keeps answering /health. So the worker restarts itself:
 * ping every `intervalMs`; after `maxFailures` consecutive failures, call
 * `onDead` (default: log + exit 1). The platform's restart policy then starts a
 * fresh process. Returns a stop function.
 */
export function startDbWatchdog(
  db: { ping(): Promise<unknown> },
  opts: { intervalMs?: number; maxFailures?: number; pingTimeoutMs?: number; onDead?: (failures: number) => void } = {},
): () => void {
  const intervalMs = opts.intervalMs ?? 30_000;
  const maxFailures = opts.maxFailures ?? 4;
  const pingTimeoutMs = opts.pingTimeoutMs ?? 5_000;
  const onDead =
    opts.onDead ??
    ((n: number) => {
      console.error(`[worker] database unreachable for ${n} consecutive checks — exiting so the platform restarts us`);
      process.exit(1);
    });
  let failures = 0;
  const check = async () => {
    try {
      await Promise.race([
        db.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), pingTimeoutMs)),
      ]);
      failures = 0;
    } catch {
      failures += 1;
      if (failures >= maxFailures) onDead(failures);
    }
  };
  const timer = setInterval(() => void check(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
