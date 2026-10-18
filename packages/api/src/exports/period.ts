import { endOfDayInTz, startOfDayInTz } from '../lib/time';

/**
 * Invoice statuses that belong in an accounting export: every invoice the
 * restaurant actually received and the system has checked.
 *
 * - `matched` / `approved` / `paid`: checked purchases.
 * - `disputed`: still a real purchase and a real tax document. It's only blocked
 *   by an open discrepancy, and the export's status column flags it. Leaving it
 *   out made October's export ₪4k short of the month's checked spend.
 *
 * Excluded: `ocr_pending` and `parsed`. They aren't verified yet: the numbers may
 * still be wrong, or a consolidated invoice is still pending its delivery notes.
 */
export const EXPORTABLE_INVOICE_STATUSES = ['matched', 'disputed', 'approved', 'paid'] as const;

export const DEFAULT_EXPORT_TZ = 'Asia/Jerusalem';

/**
 * Inclusive calendar-day bounds (`YYYY-MM-DD`) in the restaurant's timezone,
 * the same month the dashboard hero uses. With UTC bounds, an invoice dated
 * 00:00–03:00 Israel time on the 1st fell into the previous month.
 * Noon UTC is always inside the same calendar day for any |offset| < 12h.
 */
export function exportPeriodBounds(from: string, to: string, tz: string): { start: Date; end: Date } {
  return {
    start: startOfDayInTz(new Date(`${from}T12:00:00.000Z`), tz),
    end: endOfDayInTz(new Date(`${to}T12:00:00.000Z`), tz),
  };
}

/** `YYYY-MM-DD` of an instant in `tz` (the date printed in the export). */
export function localIsoDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
