/** Named refusals of ingest.resolvePageFlag, shown as copy (inbox + the compare page share it). */
export const REFUSALS = [
  'not_flagged',
  'not_a_duplicate',
  'approved_or_paid',
  'has_claim',
  'decided',
  'linked',
  'multi_page',
  'too_large',
  'too_many_pages',
  'reocr_not_enabled',
  'corrected',
  'not_unreadable',
  'not_comparable',
  'payable_required',
  'already_paid',
  'duplicate_on_file',
  'reocr_pending',
] as const;
export type Refusal = (typeof REFUSALS)[number];

/** The refusal code a tRPC error carries, if it is a named one. */
export function refusalOf(err: unknown): Refusal | null {
  const code = err instanceof Error ? err.message : '';
  return (REFUSALS as readonly string[]).includes(code) ? (code as Refusal) : null;
}
