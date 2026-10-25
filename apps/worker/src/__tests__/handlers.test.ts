import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HANDLED_QUEUES, JOB_HANDLERS } from '../handlers';

/**
 * The serverless runner looks processors up in JOB_HANDLERS; the worker starts
 * them with makeWorker('<queue>', process<Name>). Both must be the SAME function
 * for every queue — no queue the worker runs may be missing from the web runner.
 */
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const jobFiles = readdirSync(join(src, 'jobs')).filter((f) => f.endsWith('.ts'));

/** makeWorker<…>('<queue>', <processor>) in each job module. */
const registrations = jobFiles.flatMap((file) => {
  const text = readFileSync(join(src, 'jobs', file), 'utf8');
  return [...text.matchAll(/makeWorker<\w+>\('([\w-]+)',\s*(\w+)\)/g)].map((m) => ({ file, queue: m[1]!, processor: m[2]! }));
});

describe('JOB_HANDLERS (serverless) ↔ makeWorker (worker)', () => {
  it('every worker queue has a handler, and nothing else does', () => {
    expect(registrations.length).toBeGreaterThan(0);
    expect([...HANDLED_QUEUES].sort()).toEqual(registrations.map((r) => r.queue).sort());
  });

  it("each handler is the very processor the worker's makeWorker gets", async () => {
    for (const r of registrations) {
      const mod = (await import(/* @vite-ignore */ join(src, 'jobs', r.file))) as Record<string, unknown>;
      expect(typeof mod[r.processor], `${r.file} exports ${r.processor}`).toBe('function');
      expect(JOB_HANDLERS[r.queue], `${r.queue} → ${r.processor}`).toBe(mod[r.processor]);
    }
  });

  it('the worker entry starts every handled queue (index.ts start*Worker calls)', () => {
    const index = readFileSync(join(src, 'index.ts'), 'utf8');
    const started = [...index.matchAll(/^\s+(start\w+Worker)\(\),$/gm)].map((m) => m[1]);
    expect(started).toHaveLength(HANDLED_QUEUES.length);
  });

  it('every scheduled queue (cron.ts) has a handler', () => {
    const cron = readFileSync(join(src, 'cron.ts'), 'utf8');
    const scheduled = [...cron.matchAll(/makeQueue<\w+>\('([\w-]+)'\)/g)].map((m) => m[1]!);
    expect(scheduled.length).toBeGreaterThan(0);
    for (const q of scheduled) expect(HANDLED_QUEUES, q).toContain(q);
  });
});
