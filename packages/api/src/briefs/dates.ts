/** IL-time labels for the briefs (never ₪). Pure: the caller passes the instant. */
const IL_TZ = 'Asia/Jerusalem';

function parts(ref: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: IL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ref)) out[p.type] = p.value;
  return out;
}

/** "08:30" in Israel time. */
export function ilTimeLabel(ref: Date): string {
  const p = parts(ref);
  return `${p.hour}:${p.minute}`;
}

/** "25.10" (dd.MM) in Israel time: the supplier draft's date. */
export function ilDayMonthDot(ref: Date): string {
  const p = parts(ref);
  return `${p.day}.${p.month}`;
}

/**
 * "25/10" (dd/MM) in Israel time: staff texts. A slash, so the date can never be
 * read as an amount (the receiver's no-₪ test bans any `\d+[.,]\d{2}`).
 */
export function ilDayMonthSlash(ref: Date): string {
  const p = parts(ref);
  return `${p.day}/${p.month}`;
}

/** 'YYYY-MM-DD' of `ref` in Israel time. */
export function ilDate(ref: Date): string {
  const p = parts(ref);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The hour (0–23) of `ref` in Israel time. */
export function ilHour(ref: Date): number {
  return Number(parts(ref).hour);
}
