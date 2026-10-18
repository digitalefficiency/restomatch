import type { Locale } from '@/lib/i18n/config';
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
