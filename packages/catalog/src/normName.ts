import { sql } from '@restomatch/db';

type SQL = ReturnType<typeof sql>;
import { LINK_WS_CLASS } from './linkPolicy';

/**
 * SQL twin of `normalizeLinkName` (linkPolicy.ts): NFC, gershayim / geresh and
 * curly quotes folded to ASCII quotes, the shared whitespace set collapsed to
 * one space, trimmed, lower-cased. Parity is tested against the JS function,
 * NBSP and thin spaces included.
 */
export function normNameSql(col: SQL | unknown): SQL {
  return sql`lower(btrim(regexp_replace(translate(normalize(${col}, NFC), '״“”׳‘’', '"""' || repeat(chr(39), 3)), ${LINK_WS_CLASS}, ' ', 'g'), ' '))`;
}
