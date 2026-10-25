import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * "A job was just enqueued" — the hook that lets the web app run jobs itself
 * (serverless mode: no worker process at all).
 *
 * Producers call notifyEnqueued(queue) after a successful insert (enqueue() in
 * index.ts). What happens next depends on where the producer runs:
 *
 *  - inside a job runner (withRunScope — e.g. the ocr-invoice job enqueueing its
 *    match-invoice job while a runner processes it): the queue joins THAT run,
 *    so the chain completes within the same budget instead of waiting for the
 *    next cron minute;
 *  - otherwise the registered listener is told. The web app registers one at
 *    boot (apps/web/lib/jobKick.ts) that schedules an after() run; nobody else
 *    does, so in the worker process, scripts and tests this is a no-op.
 *
 * Framework-agnostic on purpose (packages/api and packages/queue know nothing of
 * Next.js). Never throws: a listener failure must not fail the producer's request
 * — the job is in the queue either way and the cron/worker picks it up.
 *
 * Both the listener and the run scope live on globalThis: Next can instantiate
 * this module once per compiled bundle, and the registration (instrumentation)
 * must be seen by the copy the tRPC route enqueues through.
 */
export type EnqueueListener = (queue: string) => void;

/** The queues an active runner claims from; a producer inside it adds to them. */
export interface RunScope {
  readonly queues: Set<string>;
}

const holder = globalThis as unknown as {
  __restomatchEnqueueListener?: EnqueueListener | null;
  __restomatchRunScope?: AsyncLocalStorage<RunScope>;
};

function runScopes(): AsyncLocalStorage<RunScope> {
  return (holder.__restomatchRunScope ??= new AsyncLocalStorage<RunScope>());
}

/** Register (or clear, with null) the process-wide enqueue listener. */
export function setEnqueueListener(fn: EnqueueListener | null): void {
  holder.__restomatchEnqueueListener = fn;
}

/** Run `fn` as a job runner: producers inside it add their queue to `scope`. */
export function withRunScope<T>(scope: RunScope, fn: () => Promise<T>): Promise<T> {
  return runScopes().run(scope, fn);
}

/** The runner this code runs inside, if any. */
export function currentRunScope(): RunScope | undefined {
  return runScopes().getStore();
}

/**
 * Tell the current runner, else the listener, that `queue` has a new job.
 * Returns who was told (tests/logs). Never throws.
 */
export function notifyEnqueued(queue: string): 'run' | 'listener' | 'none' {
  try {
    const scope = currentRunScope();
    if (scope) {
      scope.queues.add(queue);
      return 'run';
    }
    const fn = holder.__restomatchEnqueueListener;
    if (!fn) return 'none';
    fn(queue);
    return 'listener';
  } catch (err) {
    console.warn(`[queue] enqueue listener failed for ${queue}: ${err instanceof Error ? err.message : String(err)}`);
    return 'none';
  }
}
