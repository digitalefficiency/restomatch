/** Calendar months on the restaurant's wall clock (the ledger's buckets). */
export interface LedgerMonth {
  /** 'YYYY-MM' */
  key: string;
  /** First / last local day, inclusive ('YYYY-MM-DD') — the leak views' custom window. */
  from: string;
  to: string;
  /** [start, end) as instants. */
  start: Date;
  end: Date;
}

function localYmd(now: Date, tz: string): [number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now);
  return [Number(parts.find((p) => p.type === 'year')!.value), Number(parts.find((p) => p.type === 'month')!.value)];
}

/** The instant of local midnight on y-m-d in `tz`. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d));
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
      .formatToParts(guess)
      .map((x) => [x.type, x.value]),
  );
  const offset = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - guess.getTime();
  return new Date(guess.getTime() - offset);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The last `n` calendar months including the current one, newest first. */
export function ledgerMonths(now: Date, tz: string, n: number): LedgerMonth[] {
  const [y, m] = localYmd(now, tz);
  const out: LedgerMonth[] = [];
  for (let i = 0; i < n; i++) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = first.getUTCFullYear();
    const mm = first.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const next = new Date(Date.UTC(yy, mm, 1));
    out.push({
      key: `${yy}-${pad(mm)}`,
      from: `${yy}-${pad(mm)}-01`,
      to: `${yy}-${pad(mm)}-${pad(lastDay)}`,
      start: zonedMidnight(yy, mm, 1, tz),
      end: zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, 1, tz),
    });
  }
  return out;
}

/** 'YYYY-MM' of an instant on the local wall clock. */
export function monthKeyOf(at: Date, tz: string): string {
  const [y, m] = localYmd(at, tz);
  return `${y}-${pad(m)}`;
}
