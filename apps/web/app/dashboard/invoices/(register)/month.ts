/** Day of month and year·month in Israel time (the register's month rule). */
export function ilDayAndMonth(now: Date): { day: number; ym: number } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('-')
    .map(Number);
  return { day: d!, ym: y! * 12 + (m! - 1) };
}

/** Grace window: during the first days of a month an empty current month falls back to the previous one. */
export const PREVIOUS_MONTH_GRACE_DAYS = 5;

/**
 * Which register month to open. An explicit `?month=` always wins (`?month=0` is
 * the current month on purpose). Otherwise, during the first
 * PREVIOUS_MONTH_GRACE_DAYS days of a month (Israel time), an empty current month
 * opens the previous one, flagged so the page shows the "previous month" chip.
 */
export function pickRegisterMonth(args: {
  param: string | undefined;
  now: Date;
  currentMonthCount: number;
}): { monthOffset: number; fellBack: boolean } {
  if (args.param != null && args.param !== '') {
    const n = Number.parseInt(args.param, 10);
    return { monthOffset: Number.isFinite(n) ? Math.max(-24, Math.min(0, n)) : 0, fellBack: false };
  }
  const { day } = ilDayAndMonth(args.now);
  if (day <= PREVIOUS_MONTH_GRACE_DAYS && args.currentMonthCount === 0) return { monthOffset: -1, fellBack: true };
  return { monthOffset: 0, fellBack: false };
}
