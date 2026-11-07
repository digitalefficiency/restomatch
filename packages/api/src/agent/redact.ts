/**
 * Role redaction for the WhatsApp agent (WA-02), applied to EVERY tool result
 * before the model, the renderer or a link builder sees it (design §C.2).
 * Tier middleware is not redaction: several `memberProcedure` reads return ₪
 * to any member (`owner.leakHero`, `receiving.getPo`), so the agent strips by
 * key and by glyph itself, whatever the procedure returns.
 *
 * Profiles:
 *  - receiver: no ₪ anywhere. Every key matching MONEY_KEY is deleted
 *    recursively, and every string holding a ₪ sign is dropped.
 *  - chef: ₪ only from order (and later recipe) procedures; everything else
 *    as the receiver.
 *  - none: owner / manager / bookkeeper (they see ₪ on the web too).
 *
 * Interim for G-07 `can('money.view')` (not on main): MONEY_VIEW below. When
 * G-07 lands, `canViewMoney` delegates to it; the key strip stays as defence in
 * depth under H-11ʰ's server strip.
 */
import type { UserRole } from '@restomatch/db';
import { clip } from '../ask/tools';

export type RedactionProfile = 'none' | 'chef' | 'receiver';

/** Keys that carry money (or a money-derived figure). Over-stripping is the safe side. */
export const MONEY_KEY = /ils|agorot|amount|total|price|cost|vat|leak|delta/i;
/** ₪ in any spelling: the sign, ש"ח / ש״ח, a bare שח, שקל/שקלים, NIS, ILS. Hebrew has no \b, so lookarounds. */
const SHEKEL = /₪|ש["״]ח|(?<![\u05D0-\u05EA])שח(?![\u05D0-\u05EA])|שקל|\bNIS\b|\bILS\b/i;

/** Interim G-07 capability map: who may see ₪ at all. */
const MONEY_VIEW: Record<UserRole, boolean> = {
  owner: true,
  manager: true,
  bookkeeper: true,
  chef: false,
  receiver: false,
};

/** Procedures (and agent tools) whose ₪ a chef may see: orders and recipes. */
const CHEF_MONEY_PREFIXES = ['orders.', 'recipes.'] as const;

export function canViewMoney(role: UserRole): boolean {
  return MONEY_VIEW[role] === true;
}

export function profileFor(role: UserRole): RedactionProfile {
  if (role === 'receiver') return 'receiver';
  if (role === 'chef') return 'chef';
  return canViewMoney(role) ? 'none' : 'receiver';
}

/** May `role` see ₪ in the output of `source` (a procedure path like `orders.get`)? */
export function moneyAllowed(role: UserRole, source: string): boolean {
  const p = profileFor(role);
  if (p === 'none') return true;
  if (p === 'chef') return CHEF_MONEY_PREFIXES.some((pre) => source.startsWith(pre));
  return false;
}

const MAX_STRING = 200;
const MAX_ARRAY = 30;

/**
 * JSON-safe, clipped copy of a tool result with the role's money removed.
 * Dates become ISO strings; untrusted strings are clipped (control chars out).
 */
export function redactFor(role: UserRole, source: string, value: unknown): unknown {
  return walk(value, !moneyAllowed(role, source), 0);
}

function walk(value: unknown, strip: boolean, depth: number): unknown {
  if (depth > 8) return null;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const s = clip(value, MAX_STRING) ?? '';
    return strip && SHEKEL.test(s) ? undefined : s;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY)
      .map((v) => walk(v, strip, depth + 1))
      .filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (strip && MONEY_KEY.test(k)) continue;
      const w = walk(v, strip, depth + 1);
      if (w !== undefined) out[k] = w;
    }
    return out;
  }
  return null;
}

/** Test/assert helper: every money-looking key path and ₪ string left in `value`. */
export function moneyLeaks(value: unknown, path = '$'): string[] {
  const out: string[] = [];
  if (typeof value === 'string') {
    if (SHEKEL.test(value)) out.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...moneyLeaks(v, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (MONEY_KEY.test(k)) out.push(`${path}.${k}`);
      out.push(...moneyLeaks(v, `${path}.${k}`));
    }
  }
  return out;
}
