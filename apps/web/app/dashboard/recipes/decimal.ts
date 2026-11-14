import { parseNumberInput } from '@restomatch/types';

/**
 * W3-02 INTERIM for G-13ʰ's `parseDecimalInput` (packages/types, not on main
 * yet). Same call shape for the two kinds the recipe editor types — swap the
 * import for `@restomatch/types` once G-13 lands and delete this file.
 *
 *  - 'qty' → a quantity / waste / bridge factor: up to 4 decimals (the server's
 *    NUMERIC(12,4)), no thousands grouping, a decimal comma is fine ("1,5" =
 *    1.5); "1,250" is AMBIGUOUS (1250 or 1.25?) and is never guessed.
 *  - 'ils' → a menu price in ₪: up to 2 decimals, grouping allowed ("1,250"
 *    = ₪1,250; "68,50" = ₪68.50), returned as integer agorot.
 */
export type DecimalKind = 'qty' | 'ils';

export type DecimalInput =
  | { kind: 'empty' }
  /** `text` = the canonical dot-decimal string the API's DECIMAL4 regex accepts; `agorot` only for 'ils'. */
  | { kind: 'ok'; value: number; text: string; agorot: number }
  | { kind: 'ambiguous'; raw: string }
  | { kind: 'invalid'; raw: string };

const SCALE: Record<DecimalKind, number> = { qty: 4, ils: 2 };
/** "1,250" / "12,500": a thousands group or a 3-decimal comma — only a person can say. */
const COMMA_GROUP_OR_DECIMAL = /^[1-9]\d{0,2},\d{3}$/;

export function parseDecimalInput(raw: string | null | undefined, kind: DecimalKind): DecimalInput {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { kind: 'empty' };
  if (kind === 'qty' && COMMA_GROUP_OR_DECIMAL.test(trimmed)) return { kind: 'ambiguous', raw: trimmed };
  const cell = parseNumberInput(trimmed, { scale: SCALE[kind], grouping: kind === 'ils' });
  if (cell.kind === 'empty') return cell;
  if (cell.kind === 'invalid') return { kind: 'invalid', raw: trimmed };
  const scale = SCALE[kind];
  const s = String(cell.scaled).padStart(scale + 1, '0');
  const int = s.slice(0, -scale);
  const frac = s.slice(-scale).replace(/0+$/, '');
  return {
    kind: 'ok',
    value: cell.value,
    text: frac ? `${int}.${frac}` : int,
    agorot: kind === 'ils' ? cell.scaled : Math.round(cell.value * 100),
  };
}
