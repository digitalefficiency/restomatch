import { TRPCError } from '@trpc/server';
import { sql, type Database } from '@restomatch/db';
import { NEVER_CLAIMABLE_TYPES, vatBasisOf } from '../lib/claims';
import { allocateCredit } from './lifecycle';
import { creditLineSuggestions, recordCreditNote, type CreditLineSuggestion } from './service';

/**
 * AU-03 · credit suggestion (T2 "אשרו זיכוי ₪X", catalogue A12).
 *
 * A negative line on a later invoice of a supplier with open credit requests
 * is a credit the supplier already gave. This PROPOSES how it would close the
 * supplier's open claims — oldest first, integer agorot, via the same
 * `allocateCredit` the booking uses — and books nothing. A human confirms
 * (or edits the ticked claims) and only then `confirmCreditSuggestion` calls
 * `recordCreditNote` with exactly the claims the human selected.
 *
 * Amounts are on the hero basis (before VAT): `creditLineSuggestions` gives
 * abs(line_total) before VAT, so only claims measured before VAT
 * (`vatBasisOf(type) === 'excl'`) are proposed or confirmable here. A
 * DUPLICATE_INVOICE claim (incl. VAT) or a VAT_MISMATCH claim (a VAT amount)
 * is never netted against a before-VAT credit line: it goes to the manual
 * credit form, where the basis is chosen and labelled. Never grossed up.
 * W2-10 AC 8 still holds: the MANUAL credit form starts with nothing ticked;
 * only this dialog, born from a specific credit line, carries a proposal.
 */

/** Claims a credit line may close: still owed by the supplier (disputed is left to the human). */
const PROPOSABLE = ['claimed', 'letter_sent', 'acknowledged', 'credited'] as const;

export interface OpenClaimForCredit {
  id: string;
  supplierId: string;
  status: string;
  amountAgorot: number;
  creditedAgorot: number;
  claimedAt: string;
  invoiceNumber: string | null;
  discrepancyType: string;
}

export interface CreditSuggestion {
  invoiceLineId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  supplierId: string;
  supplierName: string | null;
  supplierNameEn: string | null;
  description: string;
  amountAgorot: number;
  /** Proposed allocation, oldest claim first. Nothing is booked until confirm. */
  proposal: Array<{ claimId: string; agorot: number }>;
  /** The part of the line no open claim absorbs (stays on the note as unallocated). */
  remainderAgorot: number;
  /** Every open claim of the supplier (for the editable ticks), oldest first. */
  openClaims: Array<{ claimId: string; outstandingAgorot: number; claimedAt: string; invoiceNumber: string | null; status: string }>;
}

/**
 * Pure: propose allocations for a supplier's credit lines over its open
 * claims. Lines are taken oldest invoice first; a claim absorbed by an
 * earlier line is not proposed twice.
 */
export function proposeCreditAllocations(
  lines: ReadonlyArray<CreditLineSuggestion>,
  claims: ReadonlyArray<OpenClaimForCredit>,
): CreditSuggestion[] {
  const bySupplier = new Map<string, OpenClaimForCredit[]>();
  for (const c of [...claims].sort((a, b) => a.claimedAt.localeCompare(b.claimedAt) || a.id.localeCompare(b.id))) {
    const list = bySupplier.get(c.supplierId) ?? [];
    list.push(c);
    bySupplier.set(c.supplierId, list);
  }
  // Working copy of what is still owed after earlier proposals.
  const left = new Map(claims.map((c) => [c.id, Math.max(0, c.amountAgorot - c.creditedAgorot)]));
  const ordered = [...lines].sort(
    (a, b) => (a.invoiceDate ?? '').localeCompare(b.invoiceDate ?? '') || a.invoiceLineId.localeCompare(b.invoiceLineId),
  );
  const out: CreditSuggestion[] = [];
  for (const line of ordered) {
    const open = bySupplier.get(line.supplierId) ?? [];
    if (open.length === 0 || !(line.amountAgorot > 0)) continue;
    const pool = open
      .map((c) => ({ id: c.id, amountAgorot: left.get(c.id) ?? 0, creditedAgorot: 0 }))
      .filter((c) => c.amountAgorot > 0);
    const { allocations, remainder } = pool.length
      ? allocateCredit(line.amountAgorot, pool)
      : { allocations: [], remainder: line.amountAgorot };
    for (const a of allocations) left.set(a.id, (left.get(a.id) ?? 0) - a.agorot);
    out.push({
      invoiceLineId: line.invoiceLineId,
      invoiceId: line.invoiceId,
      invoiceNumber: line.invoiceNumber,
      invoiceDate: line.invoiceDate,
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      supplierNameEn: line.supplierNameEn,
      description: line.description,
      amountAgorot: line.amountAgorot,
      proposal: allocations.map((a) => ({ claimId: a.id, agorot: a.agorot })),
      remainderAgorot: remainder,
      openClaims: open.map((c) => ({
        claimId: c.id,
        outstandingAgorot: Math.max(0, c.amountAgorot - c.creditedAgorot),
        claimedAt: c.claimedAt,
        invoiceNumber: c.invoiceNumber,
        status: c.status,
      })),
    });
  }
  // Newest credit first on the desk (it is the one the user just saw on an invoice).
  return out.reverse();
}

const rowsOf = (res: unknown) =>
  (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

async function openClaimsFor(db: Database, restaurantId: string, supplierIds: string[]): Promise<OpenClaimForCredit[]> {
  if (supplierIds.length === 0) return [];
  const res = await db.execute(sql`
    SELECT c.id, c.supplier_id, c.status, c.amount_agorot, c.credited_agorot, c.claimed_at,
           i.invoice_number, d.type AS discrepancy_type
    FROM recovery_claims c
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
    LEFT JOIN invoices i ON i.id = c.invoice_id AND i.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId}
      AND c.supplier_id IN (${sql.join(supplierIds.map((s) => sql`${s}`), sql`, `)})
      AND c.status IN (${sql.join(PROPOSABLE.map((s) => sql`${s}`), sql`, `)})
      AND c.amount_agorot > c.credited_agorot
      AND d.type NOT IN (${sql.join(NEVER_CLAIMABLE_TYPES.map((t) => sql`${t}`), sql`, `)})
    ORDER BY c.claimed_at ASC, c.id
  `);
  return rowsOf(res)
    .filter((r) => vatBasisOf(String(r.discrepancy_type)) === 'excl')
    .map((r) => ({
    id: String(r.id),
    supplierId: String(r.supplier_id),
    status: String(r.status),
    amountAgorot: Number(r.amount_agorot),
    creditedAgorot: Number(r.credited_agorot),
    claimedAt: iso(r.claimed_at),
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    discrepancyType: String(r.discrepancy_type),
  }));
}

/** Read only: the T2 credit suggestions of a restaurant. Writes nothing. */
export async function creditSuggestions(db: Database, restaurantId: string): Promise<CreditSuggestion[]> {
  const lines = await creditLineSuggestions(db, restaurantId);
  const claims = await openClaimsFor(db, restaurantId, [...new Set(lines.map((l) => l.supplierId))]);
  return proposeCreditAllocations(lines, claims);
}

export interface ConfirmCreditSuggestionInput {
  invoiceLineId: string;
  /** The claims the HUMAN ticked (the proposal, possibly edited). */
  claimIds: string[];
  idempotencyKey?: string;
  actorId?: string | null;
  at?: Date;
}

/**
 * Confirm a suggestion: verify the line and every claim are this restaurant's
 * (NOT_FOUND otherwise — a foreign id reveals nothing), that every claim is the
 * line's supplier's (BAD_REQUEST `supplier_mismatch`), then book through
 * `recordCreditNote` (idempotency, CONFLICT on a used line, oldest-first
 * allocation over the selected claims only).
 */
export async function confirmCreditSuggestion(db: Database, restaurantId: string, input: ConfirmCreditSuggestionInput) {
  const claimIds = [...new Set(input.claimIds)];
  const lineRes = await db.execute(sql`
    SELECT i.supplier_id
    FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id AND i.restaurant_id = ${restaurantId}
    WHERE il.id = ${input.invoiceLineId}
  `);
  const line = rowsOf(lineRes)[0];
  if (!line) throw new TRPCError({ code: 'NOT_FOUND', message: 'invoice line not found' });
  const claimRes = await db.execute(sql`
    SELECT c.id, c.supplier_id, d.type AS discrepancy_type
    FROM recovery_claims c
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
    WHERE c.restaurant_id = ${restaurantId}
      AND c.id IN (${sql.join(claimIds.map((id) => sql`${id}`), sql`, `)})
  `);
  const owned = rowsOf(claimRes);
  if (owned.length !== claimIds.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'claim not found' });
  if (owned.some((c) => String(c.supplier_id) !== String(line.supplier_id))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'supplier_mismatch' });
  }
  // A before-VAT credit line never closes a claim measured incl. VAT or in VAT (leak-economist 11.11).
  if (owned.some((c) => vatBasisOf(String(c.discrepancy_type)) !== 'excl')) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'basis_mismatch' });
  }
  // TODO(G-05): recordAudit 'recovery.credit_suggestion_confirmed' {automationId:'A12'} once the AuditAction exists.
  return recordCreditNote(db, restaurantId, {
    invoiceLineId: input.invoiceLineId,
    claimIds,
    idempotencyKey: input.idempotencyKey,
    actorId: input.actorId ?? null,
    at: input.at,
  });
}
