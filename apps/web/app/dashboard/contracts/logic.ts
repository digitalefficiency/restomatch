/**
 * Pure helpers for the contracts + price-alert screens (unit-tested in
 * app/dashboard/__tests__/contracts-logic.test.ts). No React, no money math —
 * ₪ figures arrive computed from the API and render through formatIls().
 */

export const FINANCE_ROLES: readonly string[] = ['owner', 'manager', 'bookkeeper'];
export const MANAGER_ROLES: readonly string[] = ['owner', 'manager'];

export type ContractsTab = 'contracts' | 'alerts' | 'thresholds';
export const CONTRACTS_TABS: ContractsTab[] = ['contracts', 'alerts', 'thresholds'];

/** Tabs a restaurant can see: contracts needs `contracts`; alerts + thresholds need `priceAlerts`. */
export function visibleTabs(flags: { contracts: boolean; priceAlerts: boolean }): ContractsTab[] {
  return CONTRACTS_TABS.filter((t) => (t === 'contracts' ? flags.contracts : flags.priceAlerts));
}

/** The active tab from `?tab=`, falling back to the first visible one. */
export function resolveTab(raw: string | undefined, visible: ContractsTab[]): ContractsTab | null {
  if (raw && (visible as string[]).includes(raw)) return raw as ContractsTab;
  return visible[0] ?? null;
}

/**
 * Today as `YYYY-MM-DD` in the restaurant's timezone (date inputs, default
 * valid-from, contract status) — the UTC date is yesterday before 02:00/03:00 IL.
 */
export function todayIso(now: Date = new Date(), timeZone = 'Asia/Jerusalem'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whether a contract row is in force on `today` (all `YYYY-MM-DD`, lexically comparable). */
export function contractStatus(
  validFrom: string,
  validTo: string | null,
  today: string = todayIso(),
): 'active' | 'expired' | 'upcoming' {
  if (validFrom > today) return 'upcoming';
  if (validTo && validTo < today) return 'expired';
  return 'active';
}

/** "3 weeks" when the window is a whole number (≥2) of weeks, else days. */
export function periodParts(days: number): { unit: 'weeks' | 'days'; count: number } {
  if (days >= 14 && days % 7 === 0) return { unit: 'weeks', count: days / 7 };
  return { unit: 'days', count: days };
}

export type ContractFileErrorKey =
  | 'TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'LEGACY_XLS'
  | 'UNREADABLE'
  | 'EMPTY'
  | 'NO_ROWS'
  | 'MAPPING';

const FILE_KEYS: ContractFileErrorKey[] = ['TOO_LARGE', 'TOO_MANY_ROWS', 'LEGACY_XLS', 'UNREADABLE', 'EMPTY', 'NO_ROWS'];

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : '';
}

/** Stable token of an import error: `CATALOG_FILE_<code>:` or `CONTRACT_MAPPING:`. */
export function contractFileErrorKey(err: unknown): ContractFileErrorKey | null {
  const message = messageOf(err);
  if (/^CONTRACT_MAPPING(?::|$)/.test(message)) return 'MAPPING';
  const m = /^CATALOG_FILE_([A-Z_]+?)(?::|$)/.exec(message);
  if (!m) return null;
  const key = m[1] as ContractFileErrorKey;
  return FILE_KEYS.includes(key) ? key : null;
}

/** Stable token of a create/update error (`CONTRACT_DUPLICATE:` / `CONTRACT_RANGE:`). */
export function contractWriteErrorKey(err: unknown): 'duplicate' | 'range' | null {
  const message = messageOf(err);
  if (/^CONTRACT_DUPLICATE(?::|$)/.test(message)) return 'duplicate';
  if (/^CONTRACT_RANGE(?::|$)/.test(message)) return 'range';
  return null;
}

/**
 * Parse a user-typed amount, locale-safe (same rules as the server import):
 * "1250", "12.5", "1,250" → 1250, "1,234.50" → 1234.5, "12,5" → 12.5; ₪ and
 * spaces ignored; anything ambiguous ("1.250,5", "1,2345", "1e3") → null.
 * Null also for ≤ 0 — a ₪0 contract would make every billed line a leak.
 */
export function parsePrice(raw: string): number | null {
  const s = raw.replace(/[₪\s\u00a0]/g, '');
  let norm: string | null = null;
  if (/^\d+(?:\.\d+)?$/.test(s)) norm = s;
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) norm = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) norm = s.replace(',', '.');
  if (norm === null) return null;
  const n = Number(norm);
  // > 0 after the 4-dp rounding the API stores (0.00004 would be ₪0.0000).
  return Number.isFinite(n) && Math.round(n * 10_000) >= 1 ? n : null;
}

/** "18" (percent, as typed) → 0.18 fraction; null outside (0, 500]. */
export function percentToFraction(raw: string): number | null {
  const n = parsePrice(raw);
  if (n === null || n <= 0 || n > 500) return null;
  return Math.round(n * 100) / 10000;
}
