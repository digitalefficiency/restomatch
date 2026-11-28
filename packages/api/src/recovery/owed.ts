import type { Database } from '@restomatch/db';
import { computeLineAllocation } from '@restomatch/charts';

/** A claim row as the owed rule reads it (snake_case, straight from SQL). */
export interface OwedInput {
  discrepancy_id: unknown;
  /** The finding's invoice (match_runs.invoice_id). */
  finding_invoice_id: unknown;
  credited_agorot: unknown;
  /** The stored GREATEST(0, amount − credited): the fallback for a claim outside the ledger. */
  outstanding: unknown;
}

/**
 * G-14 Q3 R4-2 · what is still owed on each claim: its share of the invoice's cap from THE
 * allocator (charts computeLineAllocation — live claims first, at LEAST(claim, |Δ|)) less what was
 * credited. The same ₪ as the hero, report, pay run, dock slip and claimableLines, so a letter, the
 * tracker or a reminder never asks for Σ stored claim amounts above the cap (an invoice total
 * lowered after the claims were made). A claim on a line outside the ledger keeps its stored ₪.
 * Returns agorot per input row, in order.
 */
export async function owedAgorot(db: Database, restaurantId: string, rows: readonly OwedInput[]): Promise<number[]> {
  return (await claimBasis(db, restaurantId, rows)).map((b) => b.owedAgorot);
}

/**
 * Both figures of each claim on the one basis (R5-3): `cappedAgorot` = what the claim stands for —
 * its capped share of the invoice, or what was already credited if that is more (a live claim),
 * else its stored amount — and `owedAgorot` = what
 * is still owed on it (capped share less credited; see owedAgorot). `amount_agorot` is read when
 * present (the stored claim), else outstanding + credited.
 */
export async function claimBasis(
  db: Database,
  restaurantId: string,
  rows: ReadonlyArray<OwedInput & { amount_agorot?: unknown }>,
): Promise<Array<{ cappedAgorot: number; owedAgorot: number }>> {
  const invoices = [...new Set(rows.map((r) => r.finding_invoice_id).filter((v) => v != null).map(String))];
  const allocation = invoices.length ? await computeLineAllocation(db, restaurantId, invoices) : new Map();
  return rows.map((r) => {
    const led = allocation.get(String(r.discrepancy_id));
    const credited = Number(r.credited_agorot ?? 0);
    // Credit already received can never be capped away (round 7, item 2): the claim stands for at
    // least what came back, so claimed = outstanding + credited + written off on every claim.
    if (led?.liveClaim) {
      return { cappedAgorot: Math.max(led.cappedAgorot, credited), owedAgorot: Math.max(0, led.cappedAgorot - credited) };
    }
    const stored = r.amount_agorot != null ? Number(r.amount_agorot) : Number(r.outstanding ?? 0) + credited;
    return { cappedAgorot: stored, owedAgorot: Number(r.outstanding ?? 0) };
  });
}
