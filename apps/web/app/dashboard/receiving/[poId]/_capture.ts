/**
 * After the photo: what the receiver sees when the invoice could not be
 * registered, or was registered but not read. Pure — unit-tested.
 */

/** Why the review was built without (fresh) invoice lines. */
export type OcrNotice = null | 'reading' | 'failed' | 'quota' | 'disabled' | 'ready';

/**
 * The notice for a read that did not happen. 'ocr_disabled' is not an error:
 * this account doesn't read invoices automatically — the receiver simply
 * counts against the order (calm copy).
 */
export function failedReadNotice(reason: string | null | undefined): 'quota' | 'disabled' | 'failed' {
  if (reason === 'quota_exceeded') return 'quota';
  if (reason === 'ocr_disabled') return 'disabled';
  return 'failed';
}

export function isErrorNotice(notice: OcrNotice): boolean {
  return notice === 'failed' || notice === 'quota';
}

/**
 * The invoice could not be registered (saved): say so and offer one-tap retry
 * with the same scan (registerInvoice is idempotent per scan, M8). Never fall
 * back silently to receiving with no invoice — the receiver chooses that
 * explicitly ("no invoice now") if they want it.
 */
export function onRegisterError<T>(captured: T): { step: 'SCAN_INVOICE'; retry: T } {
  return { step: 'SCAN_INVOICE', retry: captured };
}
