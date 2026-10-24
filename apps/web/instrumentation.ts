/**
 * Next.js startup hook. Runs once per server process, for BOTH runtimes; only
 * the Node runtime does real work (env + tenant-boundary boot guards live in
 * instrumentation.node.ts). Keep the dynamic import INSIDE the constant-guarded
 * `if` — see instrumentation.node.ts for why an early return is not enough.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation.node');
    await registerNode();
  }
}

/**
 * Next 15 hook: every uncaught server error (RSC render, route handler, server
 * action, middleware) — forwarded to Sentry when it is enabled; otherwise the
 * observability no-op just logs in dev. Never throws.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { captureException } = await import('@restomatch/observability');
    captureException(error, {
      path: request.path,
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
    });
  } catch {
    /* observability must never break a response */
  }
}
