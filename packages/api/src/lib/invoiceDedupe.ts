/**
 * invoices_dedupe_idx is UNIQUE on (supplier_id, invoice_number). A write that
 * hits it raises Postgres 23505 with that constraint name; drizzle may wrap
 * the driver error, so the cause chain is walked. Any OTHER unique violation
 * (or error) is not ours to translate and must surface unchanged.
 */
export function isInvoiceNumberTaken(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e = err; typeof e === 'object' && e !== null && !seen.has(e); e = (e as { cause?: unknown }).cause) {
    seen.add(e);
    const pg = e as { code?: string; constraint_name?: string; constraint?: string };
    if (pg.code === '23505') return (pg.constraint_name ?? pg.constraint) === 'invoices_dedupe_idx';
  }
  return false;
}

/** The worker's marker (apps/worker writeOcrHeader): the scanned number already
 *  belonged to another invoice of this supplier, so it was not stored. */
export interface DuplicateOfMarker {
  invoiceId: string | null;
  invoiceNumber: string;
}

export function readDuplicateOf(ocrPayload: unknown): DuplicateOfMarker | null {
  const raw = (ocrPayload as { raw?: unknown } | null | undefined)?.raw;
  const d = (raw as { duplicateOf?: unknown } | null | undefined)?.duplicateOf as
    | { invoiceId?: unknown; invoiceNumber?: unknown }
    | undefined;
  if (!d || typeof d.invoiceNumber !== 'string' || d.invoiceNumber === '') return null;
  return { invoiceId: typeof d.invoiceId === 'string' ? d.invoiceId : null, invoiceNumber: d.invoiceNumber };
}

/** The same payload with the duplicate marker removed (the number was fixed). */
export function withoutDuplicateOf<T>(ocrPayload: T): T {
  const p = ocrPayload as { raw?: unknown } | null | undefined;
  if (!p || typeof p.raw !== 'object' || p.raw === null || !('duplicateOf' in p.raw)) return ocrPayload;
  const { duplicateOf: _drop, ...raw } = p.raw as Record<string, unknown>;
  return { ...(p as object), raw } as T;
}
