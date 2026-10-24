/**
 * Pay-run dates are shown on the Israel wall clock. The month bounds arrive as UTC instants of
 * local midnight (October starts at 2026-09-30T21:00:00Z), so never slice the ISO string.
 */
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' of an instant in Asia/Jerusalem. */
export function localYmd(iso: string): string {
  return ymd.format(new Date(iso));
}

/** 'YYYY-MM' of an instant in Asia/Jerusalem (the pay run's month, e.g. for the CSV filename). */
export function localMonth(iso: string): string {
  return localYmd(iso).slice(0, 7);
}
