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
  const invoices = [...new Set(rows.map((r) => r.finding_invoice_id).filter((v) => v != null).map(String))];
  const allocation = invoices.length ? await computeLineAllocation(db, restaurantId, invoices) : new Map();
  return rows.map((r) => {
    const led = allocation.get(String(r.discrepancy_id));
    return led?.liveClaim ? Math.max(0, led.cappedAgorot - Number(r.credited_agorot ?? 0)) : Number(r.outstanding ?? 0);
  });
}
