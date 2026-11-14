/**
 * W2-09c · one period grammar (exec-desktop-10). The leak pages used three:
 * `?p=…&from&to` (views), `?m=-1` (breakdown, proof) and `?month=YYYY-MM`
 * (report). The old two answer a 308 to the `p` grammar, keeping every other
 * param. This lives here, not in next.config `redirects()`, because the target
 * needs date math (a month's last day; m = −N months back), which static
 * redirect rules can't do; the pages call it through `permanentRedirect()`
 * (also a 308).
 */

type Sp = Record<string, string | string[] | undefined>;

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The restaurant's current local month (Asia/Jerusalem) as {y, m}. */
function localMonth(now: Date, tz: string): { y: number; m: number } {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(now);
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) };
}

/** A whole local month as the `p` grammar: this/last month by name, any other as custom from–to. */
export function monthParams(y: number, m: number, now: Date, tz = 'Asia/Jerusalem'): Record<string, string> {
  const cur = localMonth(now, tz);
  const back = (cur.y - y) * 12 + (cur.m - m);
  if (back === 0) return {};
  if (back === 1) return { p: 'last_month' };
  return { p: 'custom', from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

/**
 * The `p`-grammar URL for a request that still uses `m` or `month`, or null
 * when it doesn't (or the value is invalid: the page then ignores it).
 */
export function legacyPeriodRedirect(pathname: string, sp: Sp, now: Date, tz = 'Asia/Jerusalem'): string | null {
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined));
  const m = one('m');
  const month = one('month');
  if (m == null && month == null) return null;
  let target: Record<string, string> | null = null;
  if (month != null && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    target = monthParams(Number(month.slice(0, 4)), Number(month.slice(5, 7)), now, tz);
  } else if (m != null && /^-?\d{1,2}$/.test(m) && Number(m) <= 0 && Number(m) >= -24) {
    const cur = localMonth(now, tz);
    const d = new Date(Date.UTC(cur.y, cur.m - 1 + Number(m), 1));
    target = monthParams(d.getUTCFullYear(), d.getUTCMonth() + 1, now, tz);
  }
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'm' || k === 'month' || v == null) continue;
    if (target && (k === 'p' || k === 'from' || k === 'to')) continue; // the legacy param decides the period
    for (const x of Array.isArray(v) ? v : [v]) out.append(k, x);
  }
  for (const [k, v] of Object.entries(target ?? {})) out.set(k, v);
  const qs = out.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
