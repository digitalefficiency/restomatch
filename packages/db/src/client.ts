import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/**
 * Connections per pool. Default 10; DB_POOL_MAX lowers it — e.g. 3 when the app runs
 * through Supabase's SESSION pooler (5432), which pins one server connection per
 * client connection (pool size ~15 per role on nano, two pools per instance).
 */
export function dbPoolMax(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.DB_POOL_MAX ?? 10);
  return Number.isInteger(n) && n > 0 ? n : 10;
}

export function createDb(connectionString: string) {
  // idle_timeout: release idle connections after 20 s so warm serverless instances
  // don't hold pooler slots they aren't using.
  const client = postgres(connectionString, { prepare: false, max: dbPoolMax(), idle_timeout: 20 });
  return drizzle(client, { schema });
}

/**
 * Run `fn` inside a transaction with the per-restaurant GUC set, so RLS
 * policies (`app.current_restaurant_id()`) scope every query to this tenant.
 *
 * This is the building block for DB-level RLS enforcement: wire it into the
 * tRPC `memberProcedure` (wrap `ctx.db` usage) before enabling the policies in
 * `packages/db/drizzle/rls/`. Until then it is a safe no-op overlay on top of
 * the existing application-layer `restaurantId` filtering.
 */
export async function withRestaurant<T>(
  db: Database,
  restaurantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_restaurant_id', ${restaurantId}, true)`);
    return fn(tx as unknown as Database);
  });
}

/**
 * Same idea for user-scoped (authed but not member) contexts: sets only
 * `app.current_user_id`, which the `memberships_self` / `users_self` /
 * `restaurants_member_select` RLS policies read. Used by procedures that run
 * before a restaurant is selected (onboarding) and by the auth membership
 * lookup once the web app moves to an RLS-enforced role.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx as unknown as Database);
  });
}
