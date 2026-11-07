/**
 * Split a migration file into top-level SQL statements, the way the
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
