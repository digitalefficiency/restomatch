/**
 * Deterministic date/time labels for the showcase mocks.
 *
 * The mock fixtures build their timestamps with `setHours()` in the runtime's
 * own timezone ("today at 08:12"), on the server and again in the browser. Reading
 * them back with local getters therefore prints the same "08:12" on both sides,
 * whereas a timezone-pinned `Intl` formatter would shift one of them and break
 * hydration. Output is plain digits, identical in Hebrew and English.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** "08:12" */
export function localTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "18/10" */
export function localDayMonth(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** "18/10/2026" */
export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
