import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration-shape test for 0019_user_credentials.
 *
 * Applies the REAL hand-authored migration file (drop-first for idempotency on
 * the shared, push-based test DB) and introspects the catalog to prove the three
 * identity tables land with the exact columns / nullability / defaults / FKs /
 * unique indexes the schema + RLS revokes depend on.
 */

const url = process.env.DATABASE_URL_TEST ?? 'postgres://romkoren@localhost:5432/restomatch_test';
const sql = postgres(url, { max: 1, prepare: false });

function migrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, '..', '..', 'drizzle', '0019_user_credentials.sql');
  const body = readFileSync(file, 'utf8').split('--> statement-breakpoint').join('\n');
  return `DROP TABLE IF EXISTS user_recovery_codes, password_reset_tokens, user_credentials CASCADE;\n${body}`;
}

beforeAll(async () => {
  await sql.unsafe(migrationSql());
});

afterAll(async () => {
  await sql.end();
});

describe('0019 migration shape — user_credentials', () => {
  it('has the expected columns with correct nullability + defaults', async () => {
    const rows = (await sql`
      select column_name, is_nullable, column_default, data_type
      from information_schema.columns
      where table_schema = 'public' and table_name = 'user_credentials'
      order by ordinal_position
    `) as unknown as Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>;
    const by = Object.fromEntries(rows.map((r) => [r.column_name, r]));

    expect(by.user_id?.is_nullable).toBe('NO');
    expect(by.password_hash?.is_nullable).toBe('YES'); // magic-link-only users
    expect(by.token_version?.is_nullable).toBe('NO');
    expect(by.token_version?.column_default).toContain('0');
    expect(by.failed_login_count?.is_nullable).toBe('NO');
    expect(by.failed_login_count?.column_default).toContain('0');
    expect(by.locked_until?.is_nullable).toBe('YES');
    expect(by.totp_secret_enc?.is_nullable).toBe('YES');
    expect(by.totp_enabled_at?.is_nullable).toBe('YES');
  });

  it('keys on user_id (PK) with an ON DELETE CASCADE FK to users', async () => {
    const [pk] = (await sql`
      select a.attname
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'user_credentials'::regclass and i.indisprimary
    `) as unknown as Array<{ attname: string }>;
    expect(pk?.attname).toBe('user_id');

    const [fk] = (await sql`
      select confdeltype, confrelid::regclass::text as ref
      from pg_constraint
      where conrelid = 'user_credentials'::regclass and contype = 'f'
    `) as unknown as Array<{ confdeltype: string; ref: string }>;
    expect(fk?.ref).toBe('users');
    expect(fk?.confdeltype).toBe('c'); // 'c' = cascade
  });
});

describe('0019 migration shape — reset tokens + recovery codes', () => {
  it('password_reset_tokens enforces a unique token_hash + cascades from users', async () => {
    const idx = (await sql`
      select indexname from pg_indexes
      where tablename = 'password_reset_tokens'
    `) as unknown as Array<{ indexname: string }>;
    expect(idx.map((r) => r.indexname)).toContain('password_reset_tokens_token_hash_unique');

    const [fk] = (await sql`
      select confdeltype from pg_constraint
      where conrelid = 'password_reset_tokens'::regclass and contype = 'f'
    `) as unknown as Array<{ confdeltype: string }>;
    expect(fk?.confdeltype).toBe('c');
  });

  it('user_recovery_codes enforces a unique (user_id, code_hash)', async () => {
    const idx = (await sql`
      select indexname from pg_indexes
      where tablename = 'user_recovery_codes'
    `) as unknown as Array<{ indexname: string }>;
    expect(idx.map((r) => r.indexname)).toContain('user_recovery_codes_user_code_unique');
  });
});
