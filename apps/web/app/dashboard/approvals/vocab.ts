import { intlLocaleOf, type Locale } from '@/lib/i18n/config';
import { formatDate, formatNumber, formatPercent } from '@/lib/i18n/format';
import { formatIls } from '@/lib/money';
import { translateUnit } from '@restomatch/translate/units';
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

/** Engine expected/actual by type: ₪ amounts (unit prices, totals, VAT) or quantities. */
const MONEY_VALUE_TYPES = new Set(['PRICE_HIGHER', 'PRICE_LOWER', 'TOTAL_MISMATCH', 'VAT_MISMATCH']);
const QTY_VALUE_TYPES = new Set(['QTY_SHORT', 'QTY_OVER', 'MISSING_ON_INVOICE', 'UNORDERED_ITEM']);

/**
 * Display an engine expected/actual value (NUMERIC string): ₪ through formatIls
 * at a fixed 2 decimals for the money types (so "522.6 ⇆ 575" reads
 * "₪522.60 ⇆ ₪575.00"), locale digits for quantities, and null for types whose
 * stored values are not meant for display (DATE_ANOMALY epoch ms, unknown types).
 */
export function discrepancyValue(type: string, raw: string | null | undefined, locale: Locale): string | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (MONEY_VALUE_TYPES.has(type)) return formatIls(n, { locale, maximumFractionDigits: 2 });
  if (QTY_VALUE_TYPES.has(type)) return formatNumber(n, locale, { maximumFractionDigits: 3 });
  return null;
}

/**
 * "Escalate to owner" only makes sense for a non-owner deciding an item that is
 * not already owner-routed; the owner never sees it.
 */
export function canEscalate(requiredRole: string | null | undefined, viewerRole: string | null | undefined): boolean {
  return viewerRole !== 'owner' && requiredRole !== 'owner';
}

/* ───────────────────────── W1-07 · decisions named by the money ───────────────────────── */

/** The procedure a decision button calls. Never relabel one onto another (functional-flows-08). */
export type DecisionProcedure = 'approve' | 'reject' | 'escalate';
/** What the procedure does to the row (and so to the ₪): fixed, unit-tested. */
export const DECISION_RESULT: Record<DecisionProcedure, 'accepted' | 'rejected' | 'escalated'> = {
  approve: 'accepted', // the ₪ is claimed from the supplier
  reject: 'rejected', // waived — the invoice is paid as billed
  escalate: 'escalated', // routed to the owner
};

export type DecisionAction =
  /** approve(): "דרוש ₪X מהספק" (or the duplicate twin "אל תשלם את העותק"). */
  | { kind: 'approve'; procedure: 'approve'; label: MessageKey<Tree>; done: MessageKey<Tree>; withAmount: boolean }
  /** reject(): "שלם כפי שחויב" — opens the reason chips. */
  | { kind: 'reject'; procedure: 'reject'; label: MessageKey<Tree>; done: MessageKey<Tree> }
  /** reject() with the fixed reason 'reviewed': nothing to claim, just mark it checked. */
  | { kind: 'review'; procedure: 'reject'; label: MessageKey<Tree>; done: MessageKey<Tree> }
  /** A link, not a decision: the invoice is linked to its order on the invoice screen. */
  | { kind: 'link'; label: MessageKey<Tree> };

/**
 * The per-type verb map (approvals-01). The SAME strings drive the activity
 * titles and the approval e-mail (packages/api DECISION_COPY — a unit test
 * locks them equal).
 *  • UNORDERED_ARRIVAL: only "שייך להזמנה" — nothing to decide until it is linked;
 *  • PRICE_LOWER, MISSING_ON_INVOICE: only "סמן כנבדק" — no money to claim;
 *  • DUPLICATE_INVOICE: "אל תשלם את העותק" / "שלם · זו לא כפולה";
 *  • everything else: "דרוש ₪X מהספק" / "שלם כפי שחויב".
 */
export function decisionActions(type: string, claimable = true): DecisionAction[] {
  if (type === 'UNORDERED_ARRIVAL') return [{ kind: 'link', label: 'decision.link' }];
  // No ₪ to claim (info severity, ₪0, PRICE_LOWER — packages/api isClaimableRow): a check, never "דרוש ₪X".
  if (type === 'PRICE_LOWER' || type === 'MISSING_ON_INVOICE' || !claimable) {
    return [{ kind: 'review', procedure: 'reject', label: 'decision.reviewed', done: 'decision.reviewedDone' }];
  }
  if (type === 'DUPLICATE_INVOICE') {
    return [
      // Accepting a duplicate HOLDS the copy; it is never "דרוש ₪X" nor "נדרש מהספק".
      { kind: 'approve', procedure: 'approve', label: 'decision.duplicateApprove', done: 'decision.duplicateHeld', withAmount: false },
      { kind: 'reject', procedure: 'reject', label: 'decision.duplicateReject', done: 'decision.rejected' },
    ];
  }
  return [
    { kind: 'approve', procedure: 'approve', label: 'decision.approve', done: 'decision.approved', withAmount: true },
    { kind: 'reject', procedure: 'reject', label: 'decision.reject', done: 'decision.rejected' },
  ];
}

/** The reason codes packages/api accepts on reject (WAIVE_REASON_CODES). */
export type WaiveReason =
  | 'price_agreed'
  | 'promo_missing'
  | 'received_actual'
  | 'arrives_later'
  | 'credited_elsewhere'
  | 'not_duplicate'
  | 'negligible'
  | 'rule_wrong'
  | 'other';

/** 3–5 one-tap waive reasons per type (approvals-05); "other" always last and reveals a textarea. */
export function waiveReasons(type: string): WaiveReason[] {
  switch (type) {
    case 'PRICE_HIGHER':
      return ['price_agreed', 'promo_missing', 'negligible', 'rule_wrong', 'other'];
    case 'QTY_OVER':
    case 'QTY_SHORT':
      return ['received_actual', 'arrives_later', 'credited_elsewhere', 'negligible', 'other'];
    case 'DUPLICATE_INVOICE':
      return ['not_duplicate', 'credited_elsewhere', 'rule_wrong', 'other'];
    default:
      return ['credited_elsewhere', 'negligible', 'rule_wrong', 'other'];
  }
}

/** Which label names the card's ₪ (approvals-17: a computed fact is never "estimated"). */
export function amountLabelKey(type: string): MessageKey<Tree> {
  if (type === 'PRICE_HIGHER' || type === 'PRICE_LOWER' || type === 'TOTAL_MISMATCH') return 'amountLabel.price';
  if (type === 'VAT_MISMATCH') return 'amountLabel.vat';
  if (type === 'QTY_SHORT' || type === 'QTY_OVER') return 'amountLabel.qty';
  // Ordered but never billed: nothing was charged — it is the value of the missing line.
  if (type === 'MISSING_ON_INVOICE') return 'amountLabel.missing';
  // Billed for a line nobody ordered.
  if (type === 'UNORDERED_ITEM') return 'amountLabel.unordered';
  if (type === 'DUPLICATE_INVOICE' || type === 'UNORDERED_ARRIVAL') return 'amountLabel.duplicate';
  return 'amountLabel.other';
}

/** A why-line piece: plain text, or a number/₪/token that is isolated (`<bdi>`) and tabular. */
export interface WhySegment {
  text: string;
  num?: boolean;
}

/** Fill a template's {placeholders} as isolated segments (so a ₪ never re-orders its neighbours). */
function fill(template: string, values: Record<string, string>): WhySegment[] {
  const out: WhySegment[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > last) out.push({ text: template.slice(last, m.index) });
    const v = values[m[1]!];
    out.push(v == null ? { text: m[0] } : { text: v, num: true });
    last = m.index! + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return out;
}

/** The queue row facts the why-line reads (myQueue joins). */
export interface WhyFacts {
  type: string;
  deltaAmount: string | null;
  expectedValue: string | null;
  actualValue: string | null;
  toleranceUsed: string | null;
  qtyBilled?: string | null;
  billedUnit?: string | null;
  qtyOrdered?: string | null;
  orderedUnit?: string | null;
  qtyReceived?: string | null;
  poId?: string | null;
  poRef?: string | null;
  poDate?: Date | string | null;
}

export const SEP: WhySegment = { text: ' · ' };

/** "PO-7781" or the first 8 of the id (the dock slip's fallback). */
export function poLabel(poRef: string | null | undefined, poId: string | null | undefined): string | null {
  if (poRef) return poRef;
  return poId ? `PO-${poId.slice(0, 8).toUpperCase()}` : null;
}

/**
 * The one-line "why" (approvals-06), in every density:
 *   "₪575.00 × 2 חבית במקום ₪522.60 (הזמנה PO-…, 14.10) = ₪104.80 · +10.0% · סף ±2% או ₪5".
 * Groups are separated by SEP; a type with no shown values falls back to its
 * plain-language explanation.
 */
export function whyLine(t: T, d: WhyFacts): WhySegment[][] {
  const locale = t.locale;
  const ils = (v: number) => formatIls(v, { locale, maximumFractionDigits: 2 });
  const qty = (v: string | null | undefined) =>
    v == null || !Number.isFinite(Number(v)) ? null : formatNumber(Number(v), locale, { maximumFractionDigits: 3 });
  const exp = d.expectedValue == null ? null : Number(d.expectedValue);
  const act = d.actualValue == null ? null : Number(d.actualValue);
  const delta = d.deltaAmount == null ? null : Math.abs(Number(d.deltaAmount));
  const rawUnit = d.billedUnit ?? d.orderedUnit ?? '';
  // Units are free text (mostly Hebrew); English goes through the shared translator (ק״ג → kg).
  const unit = locale === 'he' || !rawUnit ? rawUnit : (translateUnit(rawUnit) ?? rawUnit);
  const groups: WhySegment[][] = [];
  const equals = delta != null ? fill(t('why.equals'), { amount: ils(delta) }) : [];

  if ((d.type === 'PRICE_HIGHER' || d.type === 'PRICE_LOWER') && exp != null && act != null) {
    const billed = qty(d.qtyBilled);
    // The engine's two price bases: the PO line's agreed price, or the supplier's
    // historical p90 (packages/matching evaluateBaseline). A p90 is never shown as an order price.
    const isP90 = (d.toleranceUsed ?? '').startsWith('actual exceeds historical p90');
    const formula = billed
      ? fill(t(isP90 ? 'why.priceP90' : 'why.price'), { actual: ils(act), qty: billed, unit, expected: ils(exp) })
      : fill(t(isP90 ? 'why.priceP90NoQty' : 'why.priceNoQty'), { actual: ils(act), expected: ils(exp) });
    const po = poLabel(d.poRef, d.poId);
    const source = isP90
      ? [{ text: ' ' }, { text: t('why.sourceP90') }]
      : po
        ? [
            { text: ' ' },
            ...fill(t('why.sourcePo'), {
              po,
              date: d.poDate ? formatDate(d.poDate, locale, { day: '2-digit', month: '2-digit' }) : '—',
            }),
          ]
        : [];
    groups.push([...formula, ...source, ...(equals.length ? [{ text: ' ' }, ...equals] : [])]);
    if (exp > 0) {
      const pct = new Intl.NumberFormat(intlLocaleOf(locale), {
        style: 'percent',
        signDisplay: 'exceptZero',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format((act - exp) / exp);
      groups.push([{ text: pct, num: true }]);
    }
  } else if ((d.type === 'QTY_OVER' || d.type === 'QTY_SHORT') && exp != null && act != null) {
    const line =
      d.type === 'QTY_OVER'
        ? fill(t('why.qtyOver'), { billed: qty(String(act))!, unit, received: qty(String(exp))! })
        : fill(t('why.qtyShort'), { ordered: qty(String(exp))!, unit, received: qty(String(act))! });
    groups.push([...line, ...(equals.length ? [{ text: ' ' }, ...equals] : [])]);
  } else {
    groups.push([{ text: discrepancyExplain(t, d.type) }, ...(equals.length ? [{ text: ' ' }, ...equals] : [])]);
  }
  if (d.toleranceUsed) groups.push(fill(t('why.threshold'), { tolerance: toleranceLabel(t, d.toleranceUsed) }));
  return groups;
}

/** Plain text of a why-line (tests, aria descriptions). */
export function whyText(groups: WhySegment[][]): string {
  return groups.map((g) => g.map((s) => s.text).join('')).join(SEP.text);
}

/** Whole days between two instants (Israel calendar is close enough for an age chip). */
export function ageDays(from: Date | string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 86_400_000));
}

/** The CONFLICT payload a stale decision gets (packages/api DECIDED_CONFLICT_PREFIX). */
export const DECIDED_CONFLICT_PREFIX = 'approvals.decided:';
export interface DecidedConflict {
  status: string;
  role: string | null;
  name: string | null;
  at: string | null;
  self: boolean;
}
export function parseDecidedConflict(message: string | null | undefined): DecidedConflict | null {
  if (!message?.startsWith(DECIDED_CONFLICT_PREFIX)) return null;
  try {
    return JSON.parse(message.slice(DECIDED_CONFLICT_PREFIX.length)) as DecidedConflict;
  } catch {
    return null;
  }
}
