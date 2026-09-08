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
