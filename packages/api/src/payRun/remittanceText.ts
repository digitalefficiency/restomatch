/**
 * AU-14b · The payment note to a supplier (A19b): a plain-text DRAFT a human sends.
 * PURE. The server sends nothing and writes no outbox row.
 *
 *  • the invoices paid, with their totals;
 *  • offsets (G-03 `payment_deductions`), each with its credit-request number, named ONCE
 *    (decision 19: one channel per state. An offset is never also listed as a credit request);
 *  • invoices held on an UNDECIDED gap: "בבדיקה · נעדכן", with NO ₪ and NO reason (decision 18);
 *  • the net = Σ paid − Σ offsets.
 * ₪ through the server twin of formatIls() (`formatIlsAgorot`); all money in integer agorot.
 */
import { formatIlsAgorot, type ReportLocale } from '../reports/money';
import { en } from './copy/en';
import { he, type CopyKey } from './copy/he';
import type { PreflightFlag } from './preflight';

const COPY: Record<ReportLocale, Record<CopyKey, string>> = { he, en };

export function t(locale: ReportLocale, key: CopyKey, vars: Record<string, string | number | null | undefined> = {}): string {
  return COPY[locale][key].replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v == null ? '' : String(v);
  });
}

/** ₪ with agorot (a payment note shows exact amounts). */
export const ilsText = (agorot: number, locale: ReportLocale) =>
  formatIlsAgorot(agorot, { locale, maximumFractionDigits: 2 });

/** "2026-10-28" → "28.10" (he) / "28/10" (en); with the year when `withYear`. */
export function shortDate(key: string, locale: ReportLocale, withYear = false): string {
  const [y, m, d] = key.split('-');
  const sep = locale === 'he' ? '.' : '/';
  return withYear ? `${d}${sep}${m}${sep}${y}` : `${d}${sep}${m}`;
}

/** The reason text of a pre-flight flag, in the viewer's language. */
export function renderReason(f: PreflightFlag, locale: ReportLocale): string {
  const v = f.vars;
  switch (f.kind) {
    case 'possible_duplicate':
      return t(locale, f.reasonKey, {
        otherNumber: v.otherNumber ?? t(locale, 'remit.noNumber'),
        otherDate: v.otherDate ? shortDate(String(v.otherDate), locale) : '',
        otherTotal: ilsText(Number(v.otherTotalAgorot ?? 0), locale),
        otherSource: t(locale, `preflight.source.${String(v.otherSource)}` as CopyKey),
      });
    case 'bank_changed':
      return t(locale, f.reasonKey, {
        supplierName: v.supplierName,
        changedOn: v.changedOn ? shortDate(String(v.changedOn), locale) : '',
        accountLast4: v.accountLast4 ?? '????',
      });
    case 'unusual_amount':
      return t(locale, f.reasonKey, {
        ratio: new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'he-IL', { maximumFractionDigits: 1 }).format(
          Number(v.ratio),
        ),
        median: ilsText(Number(v.medianAgorot ?? 0), locale),
      });
    default:
      return t(locale, f.reasonKey, v);
  }
}

export interface RemittancePaid {
  invoiceId: string;
  invoiceNumber: string | null;
  totalAgorot: number;
}
export interface RemittanceOffset {
  /** The credit request (claim) this offset settles. Used to name it once. */
  claimId: string;
  /** Short claim number (H-03 `recovery_claims.seq_no`; until then the claim id's short form). */
  claimNo: string;
  amountAgorot: number;
  /** A DECIDED reason (accepted / resolved, M5), e.g. "חוסר 2 ק״ג סלמון". */
  reason: string;
}
export interface RemittanceInReview {
  invoiceId: string;
  invoiceNumber: string | null;
}

export interface RemittanceInput {
  supplierName: string;
  restaurantName: string;
  /** Israel date key YYYY-MM-DD. */
  paidOn: string;
  paid: RemittancePaid[];
  offsets: RemittanceOffset[];
  /** Held on an undecided gap: named as "in review" only. */
  inReview: RemittanceInReview[];
}

export interface RemittanceOutput {
  he: string;
  en: string;
  netAgorot: number;
}

/** Shortens a uuid to a calm claim number until H-03's seq_no exists. */
export const claimShortNo = (claimId: string) => claimId.replace(/-/g, '').slice(0, 6).toUpperCase();

function normalise(input: RemittanceInput) {
  const paidIds = new Set(input.paid.map((p) => p.invoiceId));
  // Decision 19: each credit request once.
  const seen = new Set<string>();
  const offsets = input.offsets.filter((o) => (seen.has(o.claimId) ? false : (seen.add(o.claimId), true)));
  // An invoice paid in this run is never also "in review".
  const inReview = input.inReview.filter((r) => !paidIds.has(r.invoiceId));
  const paidSum = input.paid.reduce((s, p) => s + p.totalAgorot, 0);
  const offSum = offsets.reduce((s, o) => s + o.amountAgorot, 0);
  return { offsets, inReview, netAgorot: paidSum - offSum };
}

function render(locale: ReportLocale, input: RemittanceInput, n: ReturnType<typeof normalise>): string {
  const num = (x: string | null) => x ?? t(locale, 'remit.noNumber');
  const lines: string[] = [t(locale, 'remit.greeting', { supplierName: input.supplierName }), ''];
  lines.push(t(locale, 'remit.paidIntro', { paidOn: shortDate(input.paidOn, locale, true) }));
  for (const p of input.paid) {
    lines.push(t(locale, 'remit.paidLine', { invoiceNumber: num(p.invoiceNumber), amount: ilsText(p.totalAgorot, locale) }));
  }
  if (n.offsets.length > 0) lines.push('');
  for (const o of n.offsets) {
    lines.push(t(locale, 'remit.offset', { amount: ilsText(o.amountAgorot, locale), claimNo: o.claimNo, reason: o.reason }));
  }
  if (n.inReview.length > 0) lines.push('');
  for (const r of n.inReview) lines.push(t(locale, 'remit.inReview', { invoiceNumber: num(r.invoiceNumber) }));
  lines.push('', t(locale, 'remit.net', { amount: ilsText(n.netAgorot, locale) }), '', t(locale, 'remit.thanks'), input.restaurantName);
  return lines.join('\n');
}

export function remittanceText(input: RemittanceInput): RemittanceOutput {
  const n = normalise(input);
  return { he: render('he', input, n), en: render('en', input, n), netAgorot: n.netAgorot };
}

/**
 * Share links for the draft. The human taps one; nothing is sent by the server.
 * `whatsapp` must already be E.164 (W2-11's normaliser); anything else gets no link.
 */
export function shareLinks(
  text: string,
  contacts: { whatsapp?: string | null; email?: string | null },
  subject: string,
): { waMe: string | null; mailto: string | null } {
  const digits = contacts.whatsapp && /^\+[1-9]\d{7,14}$/.test(contacts.whatsapp) ? contacts.whatsapp.slice(1) : null;
  const email = contacts.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacts.email) ? contacts.email : null;
  return {
    waMe: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null,
    mailto: email
      ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
      : null,
  };
}
