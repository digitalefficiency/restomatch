import { parseNumberInput } from '@restomatch/types';

/**
 * Pure helpers for the contracts + price-alert screens (unit-tested in
 * app/dashboard/__tests__/contracts-logic.test.ts). No React, no money math —
 * ₪ figures arrive computed from the API and render through formatIls().
 */

export const FINANCE_ROLES: readonly string[] = ['owner', 'manager', 'bookkeeper'];
export const MANAGER_ROLES: readonly string[] = ['owner', 'manager'];

/**
 * W2-12: "לטיפול" (`queue`) is the first and default tab. The legacy keys
 * (`contracts|alerts|thresholds`) keep working — the home teaser and the
 * price-alert e-mail link to them.
 */
export type ContractsTab = 'queue' | 'contracts' | 'alerts' | 'thresholds';
export const CONTRACTS_TABS: ContractsTab[] = ['queue', 'contracts', 'alerts', 'thresholds'];

/** Tabs a restaurant can see: queue + contracts need `contracts`; alerts + thresholds need `priceAlerts`. */
export function visibleTabs(flags: { contracts: boolean; priceAlerts: boolean }): ContractsTab[] {
  return CONTRACTS_TABS.filter((t) => (t === 'queue' || t === 'contracts' ? flags.contracts : flags.priceAlerts));
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
 * LEGACY parser, kept byte-for-byte for G-10's supplier portal
 * (`app/s/[token]/logic.ts` imports it and pins this behaviour): "1250", "12.5",
 * "1,250" → 1250, "1,234.50" → 1234.5, "12,5" → 12.5; ₪ and spaces ignored;
 * anything ambiguous ("1.250,5", "1,2345", "1e3") → null; ≤ 0 → null.
 * The contracts screens no longer use it (they use `parseContractPrice`).
 * Delete once G-10 has cut the import. TODO(G-13): parseDecimalInput.
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

/**
 * A typed contract unit price through the ONE shared number parser
 * (`parseNumberInput`, the server import's grammar), at the 4-dp NUMERIC(12,4)
 * scale — a per-gram price like "0,0125" keeps its precision (MoneyInput rounds
 * to agorot, which would move the leak baseline). Null when empty, invalid or
 * ≤ 0. TODO(G-13): parseDecimalInput.
 */
export function parseContractPrice(raw: string): number | null {
  const cell = parseNumberInput(raw, { scale: 4, grouping: true, negative: false });
  return cell.kind === 'ok' && cell.scaled >= 1 ? cell.value : null;
}

/** "18" (percent, as typed) → 0.18 fraction; null outside (0, 500]. */
export function percentToFraction(raw: string): number | null {
  const n = parseContractPrice(raw);
  if (n === null || n <= 0 || n > 500) return null;
  return Math.round(n * 100) / 10000;
}

/** The W2-12 queue card action → its money-named label key. */
export type QueueActionKey = 'offset' | 'claim' | 'request';

/**
 * Until W2-04 lands `approvals.decideMany`, the offset/claim primary is a deep
 * link into the approvals queue for that invoice, with the same label.
 */
export function approvalsDeepLink(invoiceId: string): string {
  return `/dashboard/approvals?invoice=${encodeURIComponent(invoiceId)}`;
}

/** A wa.me draft (the person sends it; nothing is sent by us). Digits only; Israeli 0XX → 972XX. */
export function waDraftLink(text: string, phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const intl = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

/** Days from `today` to `validTo` (both YYYY-MM-DD); null when open-ended. */
export function daysUntil(validTo: string | null, today: string = todayIso()): number | null {
  if (!validTo) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+validTo.slice(0, 4), +validTo.slice(5, 7) - 1, +validTo.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** The expiry chip shows within this many days (warn), and for anything expired. */
export const EXPIRY_WARN_DAYS = 30;

/** Case-insensitive product search over he/en names. */
export function matchesSearch(q: string, ...names: Array<string | null | undefined>): boolean {
  const needle = q.normalize('NFKC').trim().toLowerCase();
  if (!needle) return true;
  return names.some((n) => !!n && n.normalize('NFKC').toLowerCase().includes(needle));
}
