/**
 * Pilot kill-switch for the public showcase (pilot brief S15, part A).
 *
 * /api/showcase/ocr runs paid Claude Vision on the production key and
 * /api/showcase/upload stores prospects' invoices under invoice-scans/walk-ins/.
 * Both are OFF unless SHOWCASE_REAL_OCR=1. It is read per request, so flipping
 * the env var needs no rebuild. The receiver UI already degrades: any non-200
 * from /ocr → the demo reconciliation; `not_configured` from /upload → keep the
 * local preview (lib/supabase/client.ts).
 */
export const SHOWCASE_OCR_OFF_CODE = 'showcase_ocr_off';

export function showcaseRealOcrEnabled(): boolean {
  return process.env.SHOWCASE_REAL_OCR === '1';
}
