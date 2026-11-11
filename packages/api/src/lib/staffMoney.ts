import type { UserRole } from '@restomatch/db';

/**
 * PILOT (train B) — ₪ strip for staff roles at the API boundary.
 *
 * Owner rule: the receiver never sees ₪; the chef sees ₪ only on orders and
 * recipes. Their screens don't render these figures, but tRPC is callable
 * directly, so the money fields are nulled server-side. Same shape, same tier.
 * G-07 (#182) supersedes this with the CAP table (`money.view`,
 * `order.money.view`, `recipe.money.view`); H-11 owns the full strip and the
 * honest `number | null` typing.
 */
export const NO_MONEY_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['receiver', 'chef']);

/** Roles without `money.view` (outside the orders and recipes screens). */
export function seesNoMoney(role: UserRole): boolean {
  return NO_MONEY_ROLES.has(role);
}

/**
 * A copy of `row` with `fields` set to null. The declared type is kept on
 * purpose (non-breaking for the money roles' consumers): only roles whose
 * screens never read these fields get the nulled copy.
 */
export function nullFields<T extends object>(row: T, fields: ReadonlyArray<keyof T>): T {
  const out = { ...row } as Record<keyof T, unknown>;
  for (const f of fields) out[f] = null;
  return out as T;
}

/** Every key of `row` that ends in `Ils` / `Agorot`, plus `extra`. */
export function moneyKeys<T extends object>(row: T, extra: ReadonlyArray<keyof T> = []): Array<keyof T> {
  return [...(Object.keys(row) as Array<keyof T>).filter((k) => /(Ils|Agorot)$/.test(String(k))), ...extra];
}

/** Shekel currency token in any spelling we've seen in data or OCR text. */
const CUR = String.raw`(?:₪|ש(?:''|["״”'׳])ח|(?<!\p{L})שח(?!\p{L})|(?<!\p{L})שקל(?:ים)?(?!\p{L})|(?<![A-Za-z])(?:ILS|NIS)(?![A-Za-z]))`;
const NUM = String.raw`[-−+]?\d[\d.,]*`;
const BIDI = String.raw`[‎‏⁦-⁩]*`;

export const SHEKEL_TOKEN = new RegExp(CUR, 'iu');
const SHEKEL_TOKEN_G = new RegExp(CUR, 'giu');
const SHEKEL_FIGURE_G = new RegExp(
  String.raw`${BIDI}(?:${NUM}${BIDI}\s*${BIDI}${CUR}|${CUR}${BIDI}\s*${BIDI}${NUM})${BIDI}`,
  'giu',
);

/** Does the text carry a shekel amount or currency mark? */
export function hasShekel(text: string): boolean {
  return SHEKEL_TOKEN.test(text);
}

/** Cut every shekel figure (token + adjacent digit group) and stray token out of `text`. */
export function stripShekelFigures(text: string): string {
  return text
    .replace(SHEKEL_FIGURE_G, '')
    .replace(SHEKEL_TOKEN_G, '')
    .replace(/\s*[·:,–-]\s*$/u, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

/** `…Ils`, `…Agorot`, and a bare `agorot` (the ledger's `{ count, agorot }`). */
const MONEY_KEY = /(Ils|Agorot)$|^agorot$/;

/**
 * A deep copy of `value` with every `…Ils` / `…Agorot` / `agorot` key set to null, at any
 * depth (arrays and nested objects included). Counts, ids, dates and statuses
 * are kept. The declared type is kept on purpose (see `nullFields`).
 */
export function stripMoneyDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripMoneyDeep(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = MONEY_KEY.test(k) ? null : stripMoneyDeep(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Discrepancy types whose expected / actual are QUANTITIES. For every other type
 * (price, VAT, total, duplicate, date, unit) they are ₪ or not shown at the dock.
 */
export const QTY_DISCREPANCY_TYPES: ReadonlySet<string> = new Set([
  'QTY_SHORT',
  'QTY_OVER',
  'MISSING_ON_INVOICE',
  'UNORDERED_ITEM',
  'UNORDERED_ARRIVAL',
]);
