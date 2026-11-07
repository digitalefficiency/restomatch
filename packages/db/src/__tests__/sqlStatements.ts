/**
 * Test helper: split a migration file into top-level SQL statements, the way the
 * Supabase CLI does before it queues them into ONE pipeline (one Sync, no BEGIN).
 * Semicolons inside '…' strings, "…" identifiers, $tag$…$tag$ bodies, -- line
 * comments and nested block comments do not split.
 */
export function splitSqlStatements(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === '-' && next === '-') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
    } else if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') (depth++, (i += 2));
        else if (text[i] === '*' && text[i + 1] === '/') (depth--, (i += 2));
        else i++;
      }
    } else if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (text[i] === c && text[i + 1] === c) i += 2;
        else if (text[i] === c) {
          i++;
          break;
        } else i++;
      }
    } else if (c === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i));
      if (m) {
        const end = text.indexOf(m[0], i + m[0].length);
        i = end === -1 ? n : end + m[0].length;
      } else i++;
    } else if (c === ';') {
      out.push(text.slice(start, i + 1));
      i++;
      start = i;
    } else i++;
  }
  const tail = text.slice(start);
  if (stripSqlComments(tail).trim()) out.push(tail);
  return out.filter((s) => stripSqlComments(s).trim() !== '' && stripSqlComments(s).trim() !== ';');
}

/** The statement without leading/inline -- and block comments (good enough to read its first keywords). */
export function stripSqlComments(stmt: string): string {
  return stmt.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Statements that need an explicit transaction block, or change transaction state.
 * In the Supabase CLI pipeline (no BEGIN) they fail (LOCK: 25P01) or misbehave
 * (SET LOCAL: a WARNING and no effect; BEGIN/COMMIT/SAVEPOINT: break atomicity).
 */
export const NEEDS_TRANSACTION_BLOCK =
  /^\s*(LOCK\b|SAVEPOINT\b|RELEASE\b|ROLLBACK\b|COMMIT\b|END\b|ABORT\b|BEGIN\b|START\s+TRANSACTION\b|SET\s+LOCAL\b|SET\s+TRANSACTION\b|SET\s+CONSTRAINTS\b|DECLARE\b|PREPARE\s+TRANSACTION\b)/i;

/** Statements Postgres refuses inside an implicit (pipeline) transaction. */
export const NOT_IN_PIPELINE =
  /^\s*(VACUUM\b|CREATE\s+DATABASE\b|DROP\s+DATABASE\b|ALTER\s+SYSTEM\b|CREATE\s+TABLESPACE\b|DROP\s+TABLESPACE\b|CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b|DROP\s+INDEX\s+CONCURRENTLY\b|REINDEX\b[^;]*\bCONCURRENTLY\b|ALTER\s+TABLE\b[^;]*\bDETACH\s+PARTITION\b[^;]*\bCONCURRENTLY\b)/i;
