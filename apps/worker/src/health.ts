import { createServer, type Server } from 'node:http';
import { connection } from './queue';

/**
 * Minimal HTTP health server so a platform (Fly.io http_check, Render health
 * check, k8s probe) can verify the worker process is alive and Redis-connected.
 * The worker is otherwise a headless BullMQ consumer with no HTTP surface, so
 * without this endpoint the platform crash-loops the machine on a failed probe.
 *
 *   GET /health        → 200 liveness (process is up)
 *   GET /health/ready  → 200 when Redis answers PING, else 503 (not ready)
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
      void connection
        .ping()
        .then(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ready', redis: 'up' }));
        })
        .catch((err: unknown) => {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'not_ready',
              redis: 'down',
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
