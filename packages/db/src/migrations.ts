import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Shared migration plumbing for scripts/migrate.ts, rehearse-cutover, the
 * doctor and the upgrade-path tests.
 *
 * How the drizzle migrator decides what to run (drizzle-orm pg-core dialect):
 * it reads the NEWEST row of drizzle.__drizzle_migrations (by created_at) and
 * applies every journal entry whose `when` is greater — all of them inside ONE
 * transaction, so a failing migration rolls the whole pending batch back. Two
 * consequences the doctor checks for:
 *   - a journal entry whose `when` is OLDER than the newest applied row but is
 *     not recorded is silently skipped forever ("gap");
 *   - the file hash is recorded but never re-checked, so a migration edited
 *     after it was applied goes unnoticed ("hash drift").
 */

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'drizzle');
}

export function readJournal(dir: string = migrationsDir()): Journal {
  return JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as Journal;
}

/** sha256 of the migration file, exactly as drizzle records it in __drizzle_migrations.hash. */
export function migrationHash(tag: string, dir: string = migrationsDir()): string {
  return createHash('sha256').update(readFileSync(join(dir, `${tag}.sql`), 'utf8')).digest('hex');
}

/** A temp migrations folder holding only journal entries with idx <= throughIdx. */
export function truncatedMigrationsFolder(throughIdx: number, dir: string = migrationsDir()): string {
  const j = readJournal(dir);
  const out = mkdtempSync(join(tmpdir(), 'restomatch-migrations-'));
  mkdirSync(join(out, 'meta'));
  const entries = j.entries.filter((e) => e.idx <= throughIdx);
  for (const e of entries) copyFileSync(join(dir, `${e.tag}.sql`), join(out, `${e.tag}.sql`));
  writeFileSync(join(out, 'meta', '_journal.json'), JSON.stringify({ ...j, entries }, null, 2));
  return out;
}

export const REQUIRED_EXTENSIONS = ['vector', 'pg_trgm', 'uuid-ossp'] as const;

export interface RunMigratorOptions {
  /** Migrations folder (default: this package's drizzle/). */
  folder?: string;
  /** Receives server NOTICEs that are not the routine "already exists, skipping". */
  onNotice?: (message: string) => void;
}

/**
 * Create the extensions and run the drizzle migrator. Idempotent: on an
 * up-to-date database it is a no-op.
 */
export async function runMigrator(url: string, opts: RunMigratorOptions = {}): Promise<void> {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    onnotice: (n) => {
      const msg = String(n.message ?? '');
      if (/already exists, skipping|does not exist, skipping/.test(msg)) return;
      opts.onNotice?.(msg);
    },
  });
  try {
    await sql.unsafe(REQUIRED_EXTENSIONS.map((e) => `CREATE EXTENSION IF NOT EXISTS "${e}";`).join('\n'));
    await migrate(drizzle(sql), { migrationsFolder: opts.folder ?? migrationsDir() });
  } finally {
    await sql.end();
  }
}

/**
 * Journal entries the migrator will NEVER apply: older (`when`) than the newest
 * recorded row but not recorded themselves. Happens when a database applied a
 * later-numbered migration first (e.g. another branch's 0039 before 0029–0032).
 * Empty on a fresh database (no tracker yet).
 */
export async function findJournalGaps(url: string, dir: string = migrationsDir()): Promise<JournalEntry[]> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const [t] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as e`;
    if (!t?.e) return [];
    const rows = await sql`select created_at from drizzle.__drizzle_migrations`;
    const applied = new Set(rows.map((r) => Number(r.created_at)));
    const newest = Math.max(0, ...applied);
    return readJournal(dir).entries.filter((e) => e.when <= newest && !applied.has(e.when));
  } finally {
    await sql.end();
  }
}
