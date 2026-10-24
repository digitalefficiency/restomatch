import { createServer, type Server, type Socket } from 'node:net';
import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Cold start (orchestrator layer-2 finding): with enableOfflineQueue:false a
 * command sent before the connection is READY failed at once ("Stream isn't
 * writeable"), so the first login attempts on every fresh serverless instance
 * skipped rate limiting. The limiter must now wait for the connection (inside
 * its 1.5 s deadline) and COUNT those first attempts.
 *
 * A tiny in-process RESP server stands in for Redis (no Redis needed in CI); it
 * only starts listening 300 ms after the client is created.
 */
const counters = new Map<string, number>();
const sockets = new Set<Socket>();

function respServer(): Server {
  return createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      // Parse complete RESP arrays: *N\r\n($len\r\narg\r\n){N}
      for (;;) {
        const parsed = parseCommand(buf);
        if (!parsed) break;
        buf = buf.slice(parsed.consumed);
        sock.write(reply(parsed.args));
      }
    });
  });
}

function parseCommand(buf: string): { args: string[]; consumed: number } | null {
  if (!buf.startsWith('*')) return null;
  let i = buf.indexOf('\r\n');
  if (i < 0) return null;
  const n = Number(buf.slice(1, i));
  let pos = i + 2;
  const args: string[] = [];
  for (let k = 0; k < n; k++) {
    i = buf.indexOf('\r\n', pos);
    if (i < 0) return null;
    const len = Number(buf.slice(pos + 1, i));
    const start = i + 2;
    if (buf.length < start + len + 2) return null;
    args.push(buf.slice(start, start + len));
    pos = start + len + 2;
  }
  return { args, consumed: pos };
}

function reply(args: string[]): string {
  const cmd = args[0]!.toUpperCase();
  if (cmd === 'INFO') {
    const body = '# Server\r\nredis_version:7.2.0\r\nloading:0\r\n';
    return `$${Buffer.byteLength(body)}\r\n${body}\r\n`;
  }
  if (cmd === 'INCR') {
    const n = (counters.get(args[1]!) ?? 0) + 1;
    counters.set(args[1]!, n);
    return `:${n}\r\n`;
  }
  if (cmd === 'EXPIRE') return ':1\r\n';
  return '+OK\r\n';
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('rate limiter on a cold Redis connection', () => {
  const saved = process.env.REDIS_URL;
  let server: Server | undefined;
  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    if (saved === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved;
  });

  it('counts the first attempts while the connection is still coming up', async () => {
    const port = await freePort();
    vi.resetModules();
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    const rl = await import('../rateLimit');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Redis comes up 300 ms after the first request (cold serverless instance).
    setTimeout(() => {
      server = respServer();
      server.listen(port, '127.0.0.1');
    }, 300);

    const opts = { limit: 2, windowSec: 60, prefix: 'cold' };
    const first = await rl.enforceRateLimit('cold@example.test', opts);
    expect(first.count).toBe(1); // counted — NOT the fail-open { count: 0 }
    expect(first.allowed).toBe(true);
    await rl.enforceRateLimit('cold@example.test', opts);
    const third = await rl.enforceRateLimit('cold@example.test', opts);
    expect(third.allowed).toBe(false); // limit 2 → the 3rd attempt is blocked
    expect(warn.mock.calls.some((c) => String(c[0]).includes('failing open'))).toBe(false);
    warn.mockRestore();
  }, 15_000);
});
