import { TRPCError } from '@trpc/server';
import { sql, type Database } from '@restomatch/db';
import { vatBasisOf, type VatBasis } from '../lib/claims';
import { assertSupplierOwned } from '../tenant';
import { lockClaims, transitionClaims } from './service';

/**
 * Claim letters (W2-10, leaks-06 / deep-fix class 6): ONE draft per supplier,
 * built ONLY from that supplier's `recovery_claims` in status `claimed` with ₪
 * still owed. Never from leak-breakdown sums and never from an undecided gap
 * (decision 18): a discrepancy only reaches a letter after its decision
 * materialised a claim. Each claim sits in exactly ONE section of ONE letter
 * (decision 19, one channel per state):
 *  - `beforePayment` "לקיזוז לפני תשלום": the invoice is not paid yet — offset it;
 *  - `forCredit` "לזיכוי": the invoice is paid — ask for a credit note.
 * Σ letter = Σ its claims' outstanding agorot, to the agora (integer agorot).
 *
 * Interim (G-03 `claim_letters` not deployed): the draft is computed, not
 * saved; "mark as sent" still moves the claims to `letter_sent` via the
 * guarded transition after the 10 s undo.
 */

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export interface ClaimLetterLine {
  claimId: string;
  discrepancyId: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoicePaid: boolean;
  type: string;
  severity: string | null;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  /** ₪ asked on this line: the claim's outstanding agorot (never recomputed). */
  amountAgorot: number;
  basis: VatBasis;
  /** The engine's expected / actual / Δ — display only (the why line). */
  expected: number | null;
  actual: number | null;
  deltaAmount: number | null;
  /** Order reference (buyer-side / source ref of the PO), when the invoice matched one. */
  poRef: string | null;
  /** Evidence links (originals): the invoice, and the delivery receipt when there is one. */
  evidence: { invoiceId: string | null; goodsReceiptId: string | null; receivedAt: string | null; hasDockPhoto: boolean };
  claimedAt: string;
}

export interface ClaimLetter {
  supplierId: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  beforePayment: ClaimLetterLine[];
  forCredit: ClaimLetterLine[];
  beforePaymentAgorot: number;
  forCreditAgorot: number;
  totalAgorot: number;
  /** Every claim of this letter — what "mark as sent" moves (expected status `claimed`). */
  claimIds: string[];
}

export async function buildClaimLetters(db: Database, restaurantId: string, opts: { supplierId?: string } = {}): Promise<ClaimLetter[]> {
  const res = await db.execute(sql`
    SELECT c.id, c.discrepancy_id, c.invoice_id, c.supplier_id, c.claimed_at,
           GREATEST(0, c.amount_agorot - c.credited_agorot) AS owed_agorot,
           s.name AS supplier_name, s.name_en AS supplier_name_en,
           i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS invoice_date, (i.status = 'paid') AS paid,
           d.type, d.severity, d.expected_value, d.actual_value, d.delta_amount,
           p.canonical_name AS product_name, p.name_en AS product_name_en,
           il.raw_description AS line_description, il.raw_description_en AS line_description_en,
           COALESCE(po.customer_ref, po.source_ref) AS po_ref,
           gr.id AS gr_id, gr.received_at, (jsonb_array_length(COALESCE(gr.photos, '[]'::jsonb)) > 0) AS has_photo
    FROM recovery_claims c
    JOIN discrepancies d ON d.id = c.discrepancy_id AND d.restaurant_id = ${restaurantId}
    LEFT JOIN match_runs mr ON mr.id = d.match_run_id AND mr.restaurant_id = ${restaurantId}
    LEFT JOIN purchase_orders po ON po.id = mr.po_id AND po.restaurant_id = ${restaurantId}
    LEFT JOIN goods_receipts gr ON gr.id = mr.gr_id AND gr.restaurant_id = ${restaurantId}
    LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.restaurant_id = ${restaurantId}
    LEFT JOIN invoices i ON i.id = c.invoice_id AND i.restaurant_id = ${restaurantId}
    LEFT JOIN products p ON p.id = d.product_id AND p.restaurant_id = ${restaurantId}
    LEFT JOIN invoice_lines il ON il.id = d.invoice_line_id AND il.invoice_id = c.invoice_id
    WHERE c.restaurant_id = ${restaurantId}
      AND c.status = 'claimed'
      AND c.amount_agorot > c.credited_agorot
      ${opts.supplierId ? sql`AND c.supplier_id = ${opts.supplierId}` : sql``}
    ORDER BY c.claimed_at, c.id
  `);
  const groups = new Map<string, ClaimLetter>();
  for (const r of rowsOf(res)) {
    const key = r.supplier_id == null ? `name:${String(r.supplier_name ?? '').trim()}` : String(r.supplier_id);
    let g = groups.get(key);
    if (!g) {
      g = {
        supplierId: (r.supplier_id as string | null) ?? null,
        supplierName: (r.supplier_name as string | null) ?? null,
        supplierNameEn: (r.supplier_name_en as string | null) ?? null,
        beforePayment: [],
        forCredit: [],
        beforePaymentAgorot: 0,
        forCreditAgorot: 0,
        totalAgorot: 0,
        claimIds: [],
      };
      groups.set(key, g);
    }
    const paid = r.paid === true;
    const line: ClaimLetterLine = {
      claimId: String(r.id),
      discrepancyId: String(r.discrepancy_id),
      invoiceId: (r.invoice_id as string | null) ?? null,
      invoiceNumber: (r.invoice_number as string | null) ?? null,
      invoiceDate: iso(r.invoice_date),
      invoicePaid: paid,
      type: String(r.type),
      severity: (r.severity as string | null) ?? null,
      productName: (r.product_name as string | null) ?? null,
      productNameEn: (r.product_name_en as string | null) ?? null,
      lineDescription: (r.line_description as string | null) ?? null,
      lineDescriptionEn: (r.line_description_en as string | null) ?? null,
      amountAgorot: Number(r.owed_agorot),
      basis: vatBasisOf(String(r.type)),
      expected: num(r.expected_value),
      actual: num(r.actual_value),
      deltaAmount: num(r.delta_amount),
      poRef: (r.po_ref as string | null) ?? null,
      evidence: {
        invoiceId: (r.invoice_id as string | null) ?? null,
        goodsReceiptId: (r.gr_id as string | null) ?? null,
        receivedAt: iso(r.received_at),
        hasDockPhoto: r.has_photo === true,
      },
      claimedAt: iso(r.claimed_at)!,
    };
    if (paid) {
      g.forCredit.push(line);
      g.forCreditAgorot += line.amountAgorot;
    } else {
      g.beforePayment.push(line);
      g.beforePaymentAgorot += line.amountAgorot;
    }
    g.totalAgorot += line.amountAgorot;
    g.claimIds.push(line.claimId);
  }
  return [...groups.values()].sort(
    (a, b) => b.totalAgorot - a.totalAgorot || (a.supplierName ?? '').localeCompare(b.supplierName ?? '') || String(a.supplierId).localeCompare(String(b.supplierId)),
  );
}

/** How long a sent letter may be taken back (server-side undo, deep-fix class 6). */
export const UNSEND_WINDOW_MINUTES = 10;

/**
 * "Sent" — only on the user's confirm after the wa.me / mailto hand-off and
 * the 10 s undo (acceptance 3). Moves ALL of one supplier's letter claims
 * `claimed → letter_sent` together, guarded: the screen sends the claim ids it
 * showed; a claim that moved, vanished from the letter, or belongs to another
 * supplier is a CONFLICT and nothing moves. No server send (H-06).
 * Interim: G-03 `claim_letters` (seq no, channel, content snapshot, version)
 * is not deployed, so the letter's state lives on its claims.
 */
export async function sendLetter(
  db: Database,
  restaurantId: string,
  input: { supplierId: string; claimIds: string[]; channel: 'whatsapp' | 'email' | 'print'; actorId: string; at?: Date },
): Promise<{ sentAt: string; claimIds: string[] }> {
  await assertSupplierOwned(db, input.supplierId, restaurantId);
  const [letter] = await buildClaimLetters(db, restaurantId, { supplierId: input.supplierId });
  const want = [...new Set(input.claimIds)].sort();
  const have = [...(letter?.claimIds ?? [])].sort();
  // The claims must exist and be ours first (NOT_FOUND before any state leaks) …
  const at = input.at ?? new Date();
  const moved = await transitionClaims(db, restaurantId, {
    items: want.map((claimId) => ({ claimId, expectedStatus: 'claimed' as const })),
    to: 'letter_sent',
    note: `letter sent (${input.channel})`,
    actorId: input.actorId,
    at,
  });
  // … and be exactly this supplier's current letter: a stale screen is a CONFLICT (rolls back).
  if (want.length !== have.length || want.some((id, i) => id !== have[i])) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'this letter changed since it was opened — refresh and send again',
    });
  }
  return { sentAt: at.toISOString(), claimIds: moved.map((m) => m.id) };
}

/**
 * Take a sent letter back within UNSEND_WINDOW_MINUTES (guarded
 * `letter_sent → claimed`): every claim must still be `letter_sent`, sent
 * inside the window (CONFLICT otherwise — the screen is stale or it is too
 * late; then the claim moves on through the normal lifecycle).
 */
export async function unsendLetter(
  db: Database,
  restaurantId: string,
  input: { claimIds: string[]; actorId: string; now?: Date },
): Promise<{ claimIds: string[] }> {
  const ids = await lockClaims(db, restaurantId, [...new Set(input.claimIds)]);
  const now = input.now ?? new Date();
  const res = await db.execute(sql`
    SELECT id, status, letter_sent_at,
           (letter_sent_at >= ${now.toISOString()}::timestamptz - make_interval(mins => ${UNSEND_WINDOW_MINUTES})) AS in_window
    FROM recovery_claims
    WHERE restaurant_id = ${restaurantId} AND id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
    FOR UPDATE
  `);
  for (const r of rowsOf(res)) {
    if (r.status !== 'letter_sent') {
      throw new TRPCError({ code: 'CONFLICT', message: `claim ${String(r.id)} is ${String(r.status)}, not letter_sent — refresh` });
    }
    if (r.in_window !== true) {
      throw new TRPCError({ code: 'CONFLICT', message: `the letter was sent more than ${UNSEND_WINDOW_MINUTES} minutes ago — it can no longer be taken back` });
    }
  }
  await db.execute(sql`
    UPDATE recovery_claims SET status = 'claimed', letter_sent_at = NULL
    WHERE restaurant_id = ${restaurantId} AND id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  await db.execute(sql`
    INSERT INTO recovery_events (restaurant_id, claim_id, from_status, to_status, actor_id, note)
    SELECT ${restaurantId}, x, 'letter_sent', 'claimed', ${input.actorId}::uuid, 'letter taken back'
    FROM unnest(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]) AS x
  `);
  return { claimIds: ids };
}
