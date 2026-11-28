/**
 * Node-runtime half of the startup hook. Imported ONLY from instrumentation.ts
 * inside `if (process.env.NEXT_RUNTIME === 'nodejs')` — Next inlines
 * NEXT_RUNTIME per compilation, so webpack drops this module (and with it
 * lib/db → postgres → net/tls, lib/env → @restomatch/db → node:fs) from the EDGE
 * instrumentation bundle. An early `return` before the dynamic imports does NOT
 * achieve that: the module graph is built before dead-code elimination, so the
 * edge build failed with "Reading from node:fs is not handled" (CI web job,
 * plan v2 T0).
 */
export async function registerNode(): Promise<void> {
  const { assertWebEnv, applyRepairedDbEnv } = await import('./lib/env');
  // Fail fast on a misconfigured production environment (missing
  // DATABASE_URL_APP/RESEND/etc.) instead of booting and degrading silently.
  assertWebEnv();
  // The job queue and raw postgres() callers read DATABASE_URL themselves: hand
  // them the same repaired owner URL authDb uses.
  if (applyRepairedDbEnv()) console.warn('[env] DATABASE_URL replaced with its repaired form for this process');

  // Server-side Sentry (no-op without SENTRY_DSN; enabling needs the SDK —
  // docs/MONITORING.md). Every event goes through the PII scrubber.
  // The SDK is imported HERE by its literal name so Next's file tracing ships
  // @sentry/node in the Vercel bundle; the package's own opaque import() is
  // invisible to tracing and would end in "sdk-missing" once a DSN is set.
  const { initSentryFromEnv, captureException } = await import('@restomatch/observability');
  await initSentryFromEnv({
    service: 'web',
    loadSdk: async () =>
      (await import('@sentry/node')) as unknown as import('@restomatch/observability/sentry').SentrySdk,
  });


  // S14: the assistant's burst limit goes through the app's enforceRateLimit.
  const { registerAskRateLimit } = await import('./lib/askRateLimit');
  registerAskRateLimit();

  // Serverless jobs (no worker process): a request that enqueues OCR / match /
  // catalog work runs it right after its response (after()); everything else —
  // and anything a kick could not finish — runs from /api/cron/jobs every minute.
  const { registerJobKick } = await import('./lib/jobKick');
  registerJobKick();

  // Tenant-boundary guards (Epic 0.1/0.3): started here, NOT awaited. Next
  // caches a rejected register() for the life of the instance — every request
  // then 500s "An error occurred while loading instrumentation hook" — so one
  // CONNECT_TIMEOUT at boot took the whole site down, marketing pages included,
  // until the instance was recycled. lib/db now holds every tenant query until
  // the guard passed (lib/tenantGuard.ts), so tenant access stays fail-closed;
  // starting it early still reports a bad role or a table without RLS at boot.
  const { tenantGuardRequired } = await import('./lib/tenantGuard');
  if (tenantGuardRequired()) {
    // No I/O (postgres.js connects lazily), but an unusable tenant URL still fails the boot.
    const { ensureTenantGuard } = await import('./lib/db');
    const { isTransientDbError } = await import('./lib/bootRetry');
    void ensureTenantGuard().catch((err: unknown) => {
      const transient = isTransientDbError(err);
      const message = err instanceof Error ? err.message : String(err);
      if (transient) {
        console.warn(`[boot] tenant guard: database unreachable, runs again on the next tenant query (${message})`);
      } else {
        console.error(`[boot] tenant guard FAILED — tenant DB access is blocked on this instance: ${message}`);
      }
      try {
        captureException(err, { stage: 'tenant-guard-warmup', transient });
      } catch {
        /* observability must never break the boot */
      }
    });
  }
}
