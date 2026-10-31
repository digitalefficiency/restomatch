/**
 * Date anchors shared by the demo seeds. Every demo seed generates its data
 * relative to "today" — DEMO_TODAY (YYYY-MM-DD) when set, else today on the
 * Israeli wall clock — so anything a seed pins to a calendar date must be
 * derived from the same anchor, or the seed breaks as the calendar moves.
 */

/** Days between the contract's valid_from and the demo's "today". */
export const CONTRACT_LEAD_DAYS = 8;

/** The demo's "today" as YYYY-MM-DD (DEMO_TODAY wins, like seed.ts / seed-demo.ts). */
export function demoTodayYmd(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): string {
  const ymd =
    env.DEMO_TODAY?.trim() ||
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`DEMO_TODAY must be YYYY-MM-DD, got ${ymd}`);
  return ymd;
}

/** YYYY-MM-DD `days` calendar days before `ymd` (pure calendar arithmetic, no TZ). */
export function ymdMinusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * valid_from of the demo contract price list: CONTRACT_LEAD_DAYS before the
 * demo's "today". The seeded deliveries sit at fixed offsets from "today", so
 * this keeps exactly the window the contracts step was designed on (2026-10-10
 * for DEMO_TODAY=2026-10-18): one PO price per covered product, and the
 * PRICE_HIGHER entrecôte / salmon lines above it.
 */
export function demoContractFrom(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): string {
  return ymdMinusDays(demoTodayYmd(env, now), CONTRACT_LEAD_DAYS);
}

/**
 * 12:00 on the Israel wall clock of `today` (YYYY-MM-DD) as a UTC instant — the
 * "now" every hero / month figure of the demo check is computed at, so the check
 * describes the seeded DEMO_TODAY and not the real date. DST-correct per date
 * (25.10.2026 is the day IDT ends: 12:00 IL = 10:00Z, not 09:00Z).
 */
export function demoNow(today: string, tz = 'Asia/Jerusalem'): Date {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 12);
  const wall = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+wall.year!, +wall.month! - 1, +wall.day!, +wall.hour!, +wall.minute!);
  return new Date(guess - (asUtc - guess));
}
