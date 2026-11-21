import { sql, type Database } from '@restomatch/db';

/**
 * Schema capability detection for objects that land with G-03 / H-03 (deployed
 * ≥ 10.11). Each probe runs once per process and is cached; the kernel and its
 * helpers use the answer to pick the real path or the documented interim.
 *
 * The probes read pg_catalog only (`to_regclass`, `pg_attribute`, `pg_enum`),
 * which every role can read, so they work on the RLS app role too.
 */

type Db = Pick<Database, 'execute'>;

const rowsOf = (res: unknown): Array<Record<string, unknown>> =>
  Array.isArray(res) ? (res as Array<Record<string, unknown>>) : ((res as { rows?: Array<Record<string, unknown>> }).rows ?? []);

const cache = new Map<string, Promise<unknown>>();

function once<T>(key: string, probe: () => Promise<T>): Promise<T> {
  let hit = cache.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = probe().catch((err) => {
      cache.delete(key); // a failed probe is retried next time, never cached as "absent"
      throw err;
    });
    cache.set(key, hit);
  }
  return hit;
}

/** True when `public.<table>` exists. */
export function hasTable(db: Db, table: string): Promise<boolean> {
  return once(`table:${table}`, async () => {
    const [r] = rowsOf(await db.execute(sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS ok`));
    return r?.ok === true;
  });
}

/**
 * The SQL type of `public.<table>.<column>` (e.g. `timestamp with time zone`,
 * `discrepancy_decision`), or null when the column does not exist.
 */
export function columnType(db: Db, table: string, column: string): Promise<string | null> {
  return once(`column:${table}.${column}`, async () => {
    const [r] = rowsOf(
      await db.execute(sql`
        SELECT format_type(a.atttypid, a.atttypmod) AS type
        FROM pg_attribute a
        WHERE a.attrelid = to_regclass(${`public.${table}`})
          AND a.attname = ${column}
          AND a.attnum > 0
          AND NOT a.attisdropped
      `),
    );
    return typeof r?.type === 'string' ? r.type : null;
  });
}

export async function hasColumn(db: Db, table: string, column: string): Promise<boolean> {
  return (await columnType(db, table, column)) !== null;
}

/** True when the Postgres enum `<enumName>` has the label `<value>`. */
export function hasEnumValue(db: Db, enumName: string, value: string): Promise<boolean> {
  return once(`enum:${enumName}.${value}`, async () => {
    const [r] = rowsOf(
      await db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = ${enumName} AND e.enumlabel = ${value}
        ) AS ok
      `),
    );
    return r?.ok === true;
  });
}

/** Test hook: forget every cached probe (a test that adds a column mid-run). */
export function resetCapabilityCache(): void {
  cache.clear();
}

/** Plain-object rows from `db.execute` (postgres-js returns an array, node-pg `{ rows }`). */
export { rowsOf };
