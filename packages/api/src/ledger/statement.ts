/**
 * W3-11 · Supplier statement (כרטסת) reconciliation — pure.
 *
 * The supplier's statement of our account is compared line by line with what
 * we hold for that supplier: invoices, the credit notes we recorded, the credit
 * requests the supplier already agreed to, and what we marked paid. Every gap
 * becomes a flag; each flag later becomes a task (W2-08 TaskSource, slice b).
 *
 * Money: integer agorot only. Statement amounts are what the supplier shows
 * (incl. VAT). Our invoices compare on their incl.-VAT total. Our credit notes
 * are stored before VAT (the hero's basis), so a credit line matches a note by
 * number first, else by amount at 0% / 17% / 18% VAT.
 *
 * A credit note is never a short-pay: credit lines are matched only against
 * credit notes and agreed credit requests. They are never netted against an
 * invoice or a payment, and a payment gap is never "explained" by a credit.
 */

export type StatementLineKind = 'invoice' | 'credit' | 'payment' | 'other';

export interface StatementLine {
  /** 1-based row in the uploaded file (for the UI). */
  row: number;
  /** YYYY-MM-DD or null. */
  date: string | null;
  kind: StatementLineKind;
  number: string | null;
  /** Always positive; the kind carries the direction. */
  amountAgorot: number;
}

export interface OurInvoice {
  id: string;
  number: string | null;
  /** YYYY-MM-DD or null. */
  date: string | null;
  /** null when the invoice has no total yet (never compared as ₪0). */
  inclVatAgorot: number | null;
  /** A goods receipt (ת״מ) covers it; null = unknown (the restaurant does not receive here). */
  hasDeliveryNote: boolean | null;
  paid: boolean;
  /** Still being read (OCR): it arrived, but its numbers are not checked yet. */
  pending?: boolean;
}

export interface OurCreditNote {
  id: string;
  number: string | null;
  /** YYYY-MM-DD */
  issuedOn: string;
  /** Before VAT (credit_notes.amount_agorot). */
  amountAgorot: number;
}

export type StatementFlagKind =
  /** On the statement, not in our system: we never got this invoice. T2. */
  | 'invoice_never_got'
  /** Billed on the statement, but no delivery note shows we received it. T2. */
  | 'billed_not_received'
  /** Same invoice number, different amount (beyond the rounding allowance). T2. */
  | 'amount_mismatch'
  /** The same invoice appears on the statement more than once: a double charge. T2. */
  | 'invoice_duplicate'
  /** We recorded a credit note (or the supplier agreed to credit) and the statement does not show it. T2. */
  | 'credit_missing'
  /** The statement shows a credit we have not recorded: good news, record it. T3. */
  | 'credit_unrecorded'
  /** We marked invoices paid for more than the statement's payments. T2. */
  | 'payment_unapplied';

export interface StatementFlag {
  kind: StatementFlagKind;
  /** Statement row, when the flag comes from a statement line. */
  row: number | null;
  number: string | null;
  date: string | null;
  /** The ₪ at stake, positive. */
  amountAgorot: number;
  invoiceId?: string;
  creditNoteId?: string;
  /** amount_mismatch: statement − ours (signed). */
  diffAgorot?: number;
}

export interface StatementInput {
  lines: readonly StatementLine[];
  invoices: readonly OurInvoice[];
  creditNotes: readonly OurCreditNote[];
  /** Σ open agorot of credit requests the supplier acknowledged ("הספק אישר"), before VAT. */
  agreedOpenAgorot?: number;
  /**
   * Check payments (`payment_unapplied`). Off until real payment records exist (H-04's
   * `payments` + `payment_invoices`, 0073): the interim "marked paid" rule raises a false
   * alarm whenever we pay an invoice net of a credit note, and credits are never netted.
   */
  checkPayments?: boolean;
}

export interface StatementResult {
  flags: StatementFlag[];
  /** Earliest / latest dated line: the period the statement covers. */
  period: { from: string | null; to: string | null };
  totals: { invoicedAgorot: number; creditedAgorot: number; paidAgorot: number; otherLines: number };
  matched: { invoices: number; credits: number };
}

/** The engine's ₪0.10 total/VAT rounding allowance, in agorot. */
export const STATEMENT_TOLERANCE_AGOROT = 10;

/** Document numbers compare on their digits without leading zeros ("INV-00123" ≡ "123"). */
export function normalizeDocNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (digits) return digits;
  const t = raw.trim().toLowerCase();
  return t || null;
}

const within = (a: number, b: number) => Math.abs(a - b) <= STATEMENT_TOLERANCE_AGOROT;

/** A statement credit (incl. VAT as the supplier shows it) vs a note stored before VAT. */
function creditAmountMatches(statementAgorot: number, noteAgorot: number): boolean {
  return [0, 0.17, 0.18].some((vat) => within(statementAgorot, Math.round(noteAgorot * (1 + vat))));
}

const inPeriod = (d: string | null, p: StatementResult['period']) =>
  d != null && (p.from == null || d >= p.from) && (p.to == null || d <= p.to);

export function reconcileStatement(input: StatementInput): StatementResult {
  const flags: StatementFlag[] = [];
  const dated = input.lines.map((l) => l.date).filter((d): d is string => !!d).sort();
  const period = { from: dated[0] ?? null, to: dated[dated.length - 1] ?? null };
  const totals = { invoicedAgorot: 0, creditedAgorot: 0, paidAgorot: 0, otherLines: 0 };
  const matched = { invoices: 0, credits: 0 };

  const invByNumber = new Map<string, OurInvoice>();
  for (const inv of input.invoices) {
    const k = normalizeDocNumber(inv.number);
    if (k && !invByNumber.has(k)) invByNumber.set(k, inv);
  }
  const usedNotes = new Set<string>();
  const seenInvoices = new Set<string>();
  const noteByNumber = new Map<string, OurCreditNote>();
  for (const n of input.creditNotes) {
    const k = normalizeDocNumber(n.number);
    if (k && !noteByNumber.has(k)) noteByNumber.set(k, n);
  }

  // Invoices first, then credits (so number matches win before amount matches).
  for (const l of input.lines) {
    if (l.kind === 'payment') {
      totals.paidAgorot += l.amountAgorot;
      continue;
    }
    if (l.kind === 'other') {
      totals.otherLines += 1;
      continue;
    }
    if (l.kind !== 'invoice') continue;
    totals.invoicedAgorot += l.amountAgorot;
    const key = normalizeDocNumber(l.number);
    const ours = key ? invByNumber.get(key) : undefined;
    const base = { row: l.row, number: l.number, date: l.date };
    if (!ours) {
      flags.push({ kind: 'invoice_never_got', ...base, amountAgorot: l.amountAgorot });
      continue;
    }
    if (seenInvoices.has(ours.id)) {
      flags.push({ kind: 'invoice_duplicate', ...base, amountAgorot: l.amountAgorot, invoiceId: ours.id });
      continue;
    }
    seenInvoices.add(ours.id);
    matched.invoices += 1;
    if (ours.pending) continue;
    if (ours.inclVatAgorot != null && !within(l.amountAgorot, ours.inclVatAgorot)) {
      const diff = l.amountAgorot - ours.inclVatAgorot;
      flags.push({ kind: 'amount_mismatch', ...base, amountAgorot: Math.abs(diff), diffAgorot: diff, invoiceId: ours.id });
    }
    if (ours.hasDeliveryNote === false) {
      flags.push({ kind: 'billed_not_received', ...base, amountAgorot: l.amountAgorot, invoiceId: ours.id });
    }
  }

  const creditLines = input.lines.filter((l) => l.kind === 'credit');
  const unmatchedCredits: StatementLine[] = [];
  for (const l of creditLines) {
    totals.creditedAgorot += l.amountAgorot;
    const key = normalizeDocNumber(l.number);
    const byNo = key ? noteByNumber.get(key) : undefined;
    if (byNo && !usedNotes.has(byNo.id)) {
      usedNotes.add(byNo.id);
      matched.credits += 1;
    } else {
      unmatchedCredits.push(l);
    }
  }
  for (const l of unmatchedCredits) {
    const byAmount = input.creditNotes.find(
      (n) => !usedNotes.has(n.id) && !normalizeDocNumber(n.number) && creditAmountMatches(l.amountAgorot, n.amountAgorot),
    );
    if (byAmount) {
      usedNotes.add(byAmount.id);
      matched.credits += 1;
      continue;
    }
    flags.push({ kind: 'credit_unrecorded', row: l.row, number: l.number, date: l.date, amountAgorot: l.amountAgorot });
  }

  // Our credit notes the statement should show (issued inside its period) but does not.
  for (const n of input.creditNotes) {
    if (usedNotes.has(n.id) || !inPeriod(n.issuedOn, period)) continue;
    flags.push({
      kind: 'credit_missing',
      row: null,
      number: n.number,
      date: n.issuedOn,
      amountAgorot: n.amountAgorot,
      creditNoteId: n.id,
    });
  }
  // The supplier agreed to credit, and no unexplained credit line could be it.
  const agreed = input.agreedOpenAgorot ?? 0;
  // Unrecorded credit lines on the statement may be that very credit: recording them settles
  // the question, so the agreement is flagged only when they can't cover it (they are incl.
  // VAT, the agreement is before VAT: compare against the agreement at 0% VAT, the lowest).
  const unrecorded = flags.filter((f) => f.kind === 'credit_unrecorded').reduce((t, f) => t + f.amountAgorot, 0);
  if (agreed > 0 && unrecorded + STATEMENT_TOLERANCE_AGOROT < agreed) {
    flags.push({ kind: 'credit_missing', row: null, number: null, date: null, amountAgorot: agreed });
  }

  // What we marked paid among the invoices on this statement vs the payments it shows.
  const onStatement = new Set(
    input.lines.filter((l) => l.kind === 'invoice').map((l) => normalizeDocNumber(l.number)).filter(Boolean) as string[],
  );
  const paidOurs = input.invoices
    .filter((i) => i.paid && onStatement.has(normalizeDocNumber(i.number) ?? ''))
    .reduce((s, i) => s + (i.inclVatAgorot ?? 0), 0);
  if (input.checkPayments && paidOurs - totals.paidAgorot > STATEMENT_TOLERANCE_AGOROT) {
    flags.push({
      kind: 'payment_unapplied',
      row: null,
      number: null,
      date: period.to,
      amountAgorot: paidOurs - totals.paidAgorot,
    });
  }

  return { flags, period, totals, matched };
}
