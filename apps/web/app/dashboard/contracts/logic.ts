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

/** Today as `YYYY-MM-DD` (date inputs + default valid-from). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
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

/** Parse a user-typed number ("12.5", " 7 "); null when empty/invalid/negative. */
export function parsePrice(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** "18" (percent, as typed) → 0.18 fraction; null outside (0, 500]. */
export function percentToFraction(raw: string): number | null {
  const n = parsePrice(raw);
  if (n === null || n <= 0 || n > 500) return null;
  return Math.round(n * 100) / 10000;
}
