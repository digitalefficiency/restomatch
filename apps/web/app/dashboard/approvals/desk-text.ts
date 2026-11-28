/**
 * The approvals desk's strings from facts (DS3-04 spec §2.8). Pure: a translator (`t`) and the locale in, a string
 * out — no React, no tRPC. Every ₪ goes through `ilsText` (formatIls with the viewer's locale and two decimals, R3),
 * every amount carries its VAT basis (R7), and the figure a decision names is one figure everywhere (P6, R5).
 */
import { formatIls } from '@/lib/money';
import { formatNumber } from '@/lib/i18n/format';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { Translator } from '@/lib/i18n/translate';
import { translateUnit } from '@restomatch/translate/units';
import {
  amountBasisOf,
  costOf,
  deltaAgorot,
  remainingAfter,
  toNumber4,
  type AmountBasis,
  type HeadParts,
} from './desk-facts';
import type { DeskMode, QueueItem } from './desk-types';
import { discrepancyLabel, displayName } from './vocab';

type T = Translator<typeof approvalsHe>;
type Locale = 'he' | 'en';
/** The row facts the names read (a QueueItem satisfies it). */
type NamedRow = Pick<QueueItem, 'productName' | 'productNameEn' | 'lineDescription' | 'lineDescriptionEn'>;

/** The catalog product's name, else the invoice line's own text. (Moved from list.tsx:1572-1577.) */
export function itemName(locale: Locale, d: NamedRow): string {
  return (
    displayName(locale, d.productName, d.productNameEn) ||
    displayName(locale, d.lineDescription, d.lineDescriptionEn)
  );
}

/** The row's title: its item, else the gap's type label (invoice-level gaps have no item). */
export function rowTitle(t: T, locale: Locale, row: NamedRow & Pick<QueueItem, 'type'>): string {
  return itemName(locale, row) || discrepancyLabel(t, row.type);
}

/** The supplier's name, or the copy's fallback ("ספק" / "the supplier"). */
function supplierText(t: T, supplier: string | null | undefined): string {
  return supplier && supplier.trim() ? supplier : t('desk.cost.supplierFallback');
}

/**
 * The row's sub-line (§4.3): an item → "{supplier}, {type}"; an invoice-level gap → by its amount's basis: before VAT
 * "{supplier}, חשבונית {number}", incl. VAT "כולל מע״מ, …", the VAT itself "המע״מ עצמו, …". A row whose amount is not
 * before VAT STARTS with its basis: the line truncates at its end (R7a).
 */
export function rowSub(
  t: T,
  locale: Locale,
  row: NamedRow & Pick<QueueItem, 'type' | 'supplierName' | 'supplierNameEn' | 'invoiceNumber'>,
): string {
  const supplier = supplierText(t, displayName(locale, row.supplierName, row.supplierNameEn));
  if (itemName(locale, row)) return t('desk.row.sub', { supplier, type: discrepancyLabel(t, row.type) });
  const number = row.invoiceNumber ?? '';
  const basis = amountBasisOf(row.type);
  if (basis === 'incl') return t('desk.row.subInvoiceInclVat', { supplier, number });
  if (basis === 'vat') return t('desk.row.subInvoiceVat', { supplier, number });
  return t('desk.row.subNoItem', { supplier, number });
}

/** A unit as written (Hebrew), or its English name when one exists (as vocab.ts does for the why-line). */
export function unitText(locale: Locale, raw: string | null): string {
  if (!raw) return '';
  return locale === 'he' ? raw : (translateUnit(raw) ?? raw);
}

/** "3 ק״ג": the quantity (up to 3 decimals, the viewer's digits) and its unit. Display only. */
export function qtyText(locale: Locale, v4: bigint, unit: string | null): string {
  const n = formatNumber(toNumber4(v4), locale, { maximumFractionDigits: 3 });
  const u = unitText(locale, unit);
  return u ? `${n} ${u}` : n;
}

/** R3: every ₪ string of the desk — never formatIls' defaults (0 dp, Hebrew), which print "‏105 ₪" for 104.80. */
export function ilsText(locale: Locale, agorot: bigint | number): string {
  return formatIls(Number(agorot) / 100, { locale, maximumFractionDigits: 2 });
}

/** The reasons row's cost line: "תשלמו ל{ספק} ₪X …" (amount = |Δ|, the quantity for the qty forms). */
export function costText(t: T, locale: Locale, cost: ReturnType<typeof costOf>, supplier: string | null): string {
  return t(`desk.cost.${cost.form}`, {
    supplier: supplierText(t, supplier),
    amount: ilsText(locale, cost.amountAgorot),
    qty: cost.qty4 != null ? qtyText(locale, cost.qty4, cost.unit ?? null) : '',
  });
}

/** The bar's next line: what comes after this decision (desk) or what is left on this invoice (landing). */
export function nextLineText(t: T, summaryCount: number, mode: DeskMode): string {
  return t(mode === 'single' ? 'desk.next.landing' : 'desk.next.line', { count: remainingAfter(summaryCount) });
}

/** R7: the basis word beside an amount: excl "לפני מע״מ", vat "סכום המע״מ עצמו", incl "כולל מע״מ". */
export function basisText(t: T, basis: AmountBasis): string {
  if (basis === 'vat') return t('desk.calc.vatItself');
  if (basis === 'incl') return t('desk.basis.incl');
  return t('summary.atRiskBasis');
}

/**
 * P6 + R5: the figure a decision names (the button, the toast and the announcer agree). The claim variant names the
 * claim (claimAgorot, what the server commits as seenClaimAgorot); hold-the-copy, review, pay as billed and escalate
 * name |Δ|. Null when that figure is 0 (a ₪0 claim, a Δ-0 gap): then no amount and no basis are printed.
 */
export function decisionAmount(
  row: Pick<QueueItem, 'type' | 'deltaAmount' | 'claimAgorot'>,
  kind: 'claim' | 'delta',
): { agorot: bigint; basis: AmountBasis } | null {
  const basis = amountBasisOf(row.type);
  if (kind === 'claim') {
    const claim = Number.isFinite(row.claimAgorot) ? Math.trunc(row.claimAgorot) : 0;
    return claim > 0 ? { agorot: BigInt(claim), basis } : null;
  }
  const delta = deltaAgorot(row);
  return delta != null && delta > 0n ? { agorot: delta, basis } : null;
}

/** The decision toast: "{verb} · {amount} {basis}", or the verb alone when the decision names no amount (R5). */
export function toastText(t: T, locale: Locale, verb: string, amount: { agorot: bigint; basis: AmountBasis } | null): string {
  if (!amount) return verb;
  return t('desk.toast.done', { verb, amount: ilsText(locale, amount.agorot), basis: basisText(t, amount.basis) });
}

/** The bulk / group toast: always before VAT (a VAT gap never joins a batch, R6). */
export function batchToastText(t: T, locale: Locale, count: number, sumAgorot: number): string {
  return t('desk.toast.batchDone', { count, amount: ilsText(locale, sumAgorot) });
}

/**
 * The announcer after a decision (§5.12): "{verb} · {what}. נותרו # פערים. הבא: {next}" (or the last-gap sentence);
 * `what` = the decided gap's title and the amount with its basis; `remaining` = remainingAfter(the count BEFORE the
 * decision); while single keys are on (the store, read by the caller at that moment) the undo key follows (R15).
 */
export function announceDecided(
  t: T,
  locale: Locale,
  verb: string,
  decided: QueueItem,
  amount: { agorot: bigint; basis: AmountBasis } | null,
  next: QueueItem | null,
  remaining: number,
  singleKeys: boolean,
): string {
  const what = decidedWhat(t, locale, decided, amount);
  const said = next
    ? t('desk.sr.decided', {
        verb,
        what,
        count: remaining,
        next: [discrepancyLabel(t, next.type), itemName(locale, next)].filter(Boolean).join(', '),
      })
    : t('desk.sr.decidedLast', { verb, what });
  return withUndoKey(t, said, singleKeys);
}

/**
 * The announcer when the next gap is not known — the server holds more but its next page did not load: "{verb} ·
 * {what}" (the undo key after it while single keys are on). Never `desk.sr.decidedLast` ("אין עוד פערים"): the queue
 * is not empty. Composed with " · " as the bulk announcement is (§5.12: "{verb} · {desk.toast.batchDone}").
 */
export function announceDecidedNoNext(
  t: T,
  locale: Locale,
  verb: string,
  decided: QueueItem,
  amount: { agorot: bigint; basis: AmountBasis } | null,
  singleKeys: boolean,
): string {
  return withUndoKey(t, `${verb} · ${decidedWhat(t, locale, decided, amount)}`, singleKeys);
}

/** The decided gap in the announcer: its title and the amount with its basis (R7d). */
function decidedWhat(t: T, locale: Locale, decided: QueueItem, amount: { agorot: bigint; basis: AmountBasis } | null): string {
  return [rowTitle(t, locale, decided), amount ? `${ilsText(locale, amount.agorot)} ${basisText(t, amount.basis)}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** R15: while single keys are on (the store, read by the caller at that moment) the undo key follows. */
function withUndoKey(t: T, said: string, singleKeys: boolean): string {
  return singleKeys ? `${said} ${t('desk.sr.undoKey')}` : said;
}

/** Tests only: the head sentence as plain text, `{n}` replaced by the number (the view renders it with <Template>). */
export function headPlainText(t: T, locale: Locale, parts: HeadParts): string {
  if (parts.kind === 'empty') return t('desk.head.empty');
  const gaps = t('desk.head.gaps', { count: parts.count, n: formatNumber(parts.count, locale) });
  const sum =
    parts.claimableIls > 0
      ? t('desk.head.sum', { amount: ilsText(locale, Math.round(parts.claimableIls * 100)) })
      : t('desk.head.noSum');
  if (parts.clause === 'none') return t('desk.head.sentence', { gaps, sum });
  const blockers =
    parts.clause === 'one'
      ? t('desk.head.blockOne')
      : parts.clause === 'both'
        ? t('desk.head.blockBoth')
        : parts.clause === 'all'
          ? t('desk.head.blockAll')
          : t('desk.head.blockSome', { count: parts.blockers, n: formatNumber(parts.blockers, locale) });
  return t('desk.head.sentenceBlock', { gaps, sum, blockers });
}
