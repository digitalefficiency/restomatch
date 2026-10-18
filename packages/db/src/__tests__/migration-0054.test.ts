import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0054_leak_check_sandbox: the two sandbox tables
 * exist with RLS ENABLED and NO policies (the tenant role sees nothing), the
 * 7-day retention / mode / count CHECKs hold, and the claim FK sets NULL when
 * the restaurant goes away.
 */
const sql = postgres(testDbUrl(), { max: 1, prepare: false });

afterAll(async () => {
  await sql`delete from leak_check_sessions where email = 'shape-0054@test.local'`;
  await sql.end();
});

const insert = (over: Record<string, unknown> = {}) =>
  sql`insert into leak_check_sessions ${sql({
    email: 'shape-0054@test.local',
    ip_hash: 'h',
    ocr_mode: 'stub',
    invoice_count: 1,
    ...over,
  } as Record<string, string | number>)} returning id, created_at, expires_at`;

describe('0054 migration shape', () => {
  it('creates both sandbox tables with RLS on and no policies', async () => {
    const rows = (await sql`
      select c.relname, c.relrowsecurity,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relname in ('leak_check_sessions', 'leak_check_ocr_usage')
      order by c.relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean; policies: number }>;
    expect(rows).toEqual([
      { relname: 'leak_check_ocr_usage', relrowsecurity: true, policies: 0 },
      { relname: 'leak_check_sessions', relrowsecurity: true, policies: 0 },
    ]);
  });

  it('has no restaurant_id column (the sandbox is not tenant data)', async () => {
    const cols = (await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'leak_check_sessions' and column_name = 'restaurant_id'
    `) as unknown as unknown[];
    expect(cols).toEqual([]);
  });

  it('defaults to a 7-day expiry and rejects a longer retention', async () => {
    const [row] = (await insert()) as unknown as Array<{ id: string; created_at: Date; expires_at: Date }>;
    expect(row!.expires_at.getTime() - row!.created_at.getTime()).toBe(7 * 24 * 3600 * 1000);
    await expect(
      sql`update leak_check_sessions set expires_at = created_at + interval '8 days' where id = ${row!.id}`,
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects an unknown OCR mode, 0 or 11 invoices, and a negative leak', async () => {
    await expect(insert({ ocr_mode: 'gpt' })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ invoice_count: 0 })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ invoice_count: 11 })).rejects.toMatchObject({ code: '23514' });
    await expect(insert({ leak_agorot: -1 })).rejects.toMatchObject({ code: '23514' });
  });

  it('a claimed session survives its restaurant being deleted (FK sets NULL)', async () => {
    const [r] = (await sql`insert into restaurants (name) values ('0054 shape') returning id`) as unknown as Array<{ id: string }>;
    const [s] = (await insert({ claimed_restaurant_id: r!.id })) as unknown as Array<{ id: string }>;
    await sql`delete from restaurants where id = ${r!.id}`;
    const [after] = (await sql`select claimed_restaurant_id from leak_check_sessions where id = ${s!.id}`) as unknown as Array<{
      claimed_restaurant_id: string | null;
    }>;
    expect(after!.claimed_restaurant_id).toBeNull();
  });
});
