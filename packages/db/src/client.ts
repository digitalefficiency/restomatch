import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { prepare: false, max: 10 });
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
