import type { Locale } from '@/lib/i18n/config';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import type { MessageKey, Translator } from '@/lib/i18n/translate';
import type { he } from '@/lib/i18n/messages/approvals/he';

/**
 * Shared discrepancy vocabulary (12 types, severities, statuses, routing
 * reasons) from the 'approvals' namespace, looked up by the raw DB value.
 * Unknown values fall back to the raw string instead of a dotted key.
 * Used by the overview, leaks and approvals pages.
 */
type T = Translator<typeof he>;
type Tree = typeof he;

function pick<G extends keyof Tree>(t: T, group: G, value: string | null | undefined, leaf?: string) {
  if (!value) return '';
  const key = `${group}.${value}${leaf ? `.${leaf}` : ''}` as MessageKey<Tree>;
  const out = t(key);
  return out === key ? value : out;
}

export const discrepancyLabel = (t: T, type: string) => pick(t, 'types', type, 'label');
export const discrepancyExplain = (t: T, type: string) => pick(t, 'types', type, 'explain');
export const severityLabel = (t: T, severity: string) => pick(t, 'severity', severity);
export const resolutionLabel = (t: T, status: string) => pick(t, 'resolution', status);

/** Routing reason by stable rule id; falls back to the stored (Hebrew) name. */
export function ruleLabel(t: T, ruleId: string | null | undefined, ruleName: string | null | undefined) {
  if (ruleId) {
    const out = pick(t, 'rules', ruleId);
    if (out !== ruleId) return out;
  }
  return ruleName ?? '';
}

/** English display name when the locale is English and one exists; else Hebrew. */
export function displayName(
  locale: Locale,
  he: string | null | undefined,
  en: string | null | undefined,
): string {
  if (locale === 'en' && en && en.trim()) return en;
  return he ?? '';
}

/**
 * The engine stores each discrepancy's tolerance as a fixed English string
 * (packages/matching, immutable). Localize the known shapes for display — ₪ via
 * formatIls, % via formatPercent; an unknown string is shown as stored.
 */
export function toleranceLabel(t: T, raw: string | null | undefined): string {
  if (!raw) return '';
  const locale = t.locale;
  const ils = (v: string) => {
    const n = Number(v);
    return formatIls(n, { locale, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 });
  };
  const pct = (v: string) => formatPercent(Number(v) / 100, locale, 2);
  let m: RegExpMatchArray | null;
  if ((m = raw.match(/^price: ±([\d.]+)% or ₪([\d.]+)$/))) return t('tolerance.price', { pct: pct(m[1]!), amount: ils(m[2]!) });
  if ((m = raw.match(/^qty: ±([\d.]+)% or ([\d.]+) units$/)))
    return t('tolerance.qty', { pct: pct(m[1]!), units: formatNumber(Number(m[2]), locale) });
  if ((m = raw.match(/^±(\d+) days from expected delivery$/))) return t('tolerance.date', { days: formatNumber(Number(m[1]), locale) });
  if ((m = raw.match(/^±₪([\d.]+)$/))) return t('tolerance.total', { amount: ils(m[1]!) });
  if ((m = raw.match(/^([\d.]+)% VAT on subtotal, ±₪([\d.]+)$/))) return t('tolerance.vat', { rate: pct(m[1]!), amount: ils(m[2]!) });
  if ((m = raw.match(/^actual exceeds historical p90 of ₪([\d.]+)$/))) return t('tolerance.p90', { amount: ils(m[1]!) });
  const fixed: Record<string, MessageKey<Tree>> = {
    'invoice number uniqueness per supplier': 'tolerance.duplicate',
    'PO must exist for invoice': 'tolerance.poRequired',
    'unit must match between PO and invoice': 'tolerance.unit',
    'billed quantity exceeds received quantity': 'tolerance.billedOverReceived',
    'PO line must appear on invoice': 'tolerance.missingLine',
    'invoice line must match a PO line': 'tolerance.unorderedLine',
  };
  return fixed[raw] ? t(fixed[raw]) : raw;
}
