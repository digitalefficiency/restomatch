/**
 * W2-11 · 24 h time input (he-IL never shows AM/PM). Pure; unit-tested.
 * Chips cover 06:00–14:00 every 30 min; anything else is typed as HH:MM.
 */
export const TIME_CHIPS: readonly string[] = Array.from({ length: 17 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

/** Typed digits → a masked "HH:MM" draft ("930" → "9:30", "0930" → "09:30"). */
export function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, d.length - 2)}:${d.slice(-2)}`;
}

/** A complete, valid 24 h time → canonical "HH:MM"; anything else → null. */
export function parseTime(raw: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
