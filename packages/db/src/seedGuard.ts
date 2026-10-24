/**
 * Hard guard for the destructive dev tools (seed.ts, seed-demo.ts, reset.ts):
 * they DELETE tenant data, so they may only ever touch a local database.
 *
 * The old guard was `url.includes('localhost') || url.includes('_test')`, which a
 * production URL passes as soon as the string appears anywhere —
 * `postgres://…@db.<ref>.supabase.co/postgres?application_name=localhost`, or a
 * remote database that happens to be called `x_test`. This one parses the URL and
 * looks at the HOST only.
 *
 * Allowed: localhost / 127.0.0.1 / ::1 / the docker-compose service name `postgres`.
 * Escape hatch for a dedicated, disposable demo/staging database:
 * `SEED_ALLOW_REMOTE_HOST=<exact hostname>` (must equal the URL's host exactly).
 * The production Supabase project is refused even then.
 */
export const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres']);

/** Production Supabase project ref (STATE.md) — never a seed target, even with the escape hatch. */
export const PRODUCTION_DB_MARKERS = ['cringgshiafwsszyqufo'];

export function seedTargetProblem(url: string, env: NodeJS.ProcessEnv = process.env): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
  if (PRODUCTION_DB_MARKERS.some((m) => url.toLowerCase().includes(m))) {
    return `refusing: ${host} is the PRODUCTION database`;
  }
  if (LOCAL_DB_HOSTS.has(host)) return null;
  const allowed = env.SEED_ALLOW_REMOTE_HOST?.trim().toLowerCase();
  if (allowed && allowed === host) return null;
  return `refusing: ${host} is not a local database (set SEED_ALLOW_REMOTE_HOST=${host} only for a disposable demo DB)`;
}

/** True for a local Postgres (the dev/test boxes) — the only place a FULL wipe is allowed. */
export function isLocalDbUrl(url: string): boolean {
  try {
    return LOCAL_DB_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The Supabase project ref a URL points at: the `<ref>` of a pooler user
 * `postgres.<ref>` (session/transaction pooler hosts are shared by every project
 * in a region), else of a direct host `db.<ref>.supabase.co`. null otherwise.
 */
export function supabaseProjectRef(url: string): string | null {
  try {
    const u = new URL(url);
    const user = decodeURIComponent(u.username);
    const fromUser = /^[a-z_]+\.([a-z0-9]{20})$/i.exec(user)?.[1];
    if (fromUser) return fromUser.toLowerCase();
    return /^db\.([a-z0-9]{20})\.supabase\.co$/i.exec(u.hostname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Throws unless `url` is a database the destructive dev tools may wipe. */
export function assertSeedTarget(url: string, tool: string, env: NodeJS.ProcessEnv = process.env): void {
  const problem = seedTargetProblem(url, env);
  if (problem) {
    throw new Error(`[${tool}] ${problem} — this tool DELETES tenant data. Target: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  }
}
