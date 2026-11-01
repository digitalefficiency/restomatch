import { expect, type APIRequestContext } from '@playwright/test';

type TrpcGet = <T>(request: APIRequestContext, path: string, input: unknown) => Promise<T>;
const trpcGet: TrpcGet = async (request, path, input) => {
  const res = await request.get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  expect(res.status(), path).toBe(200);
  return ((await res.json()) as { result: { data: { json: never } } }).result.data.json;
};

const israelDay = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const addDays = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
};

/** This month's hero leak (₪) — everything the home hero counts, today's rows included. */
export async function thisMonthLeakIls(request: APIRequestContext): Promise<number> {
  return (await trpcGet<{ leakIls: number }>(request, 'owner.leakHero', {})).leakIls;
}

/**
 * The month the demo seed populated, as a `monthOffset` (0 = this month, -1 = last month).
 *
 * The e2e seed dates everything from today (DEMO_TODAY defaults to today in Asia/Jerusalem) and
 * invoices only deliveries BEFORE today. So in the first days of a month the app's current month
 * holds none of the seed's leak yet — only, perhaps, a few rows other specs created today, which
 * lack the seed's mix (zero-₪ findings, more invoices than the top catches). Specs that assert on
 * "a populated month" read the month that holds the seed's leak: this month once the seed has
 * leaked in it (1st … yesterday), otherwise last month. Same assertions, on the month with data.
 */
export async function seededLeakMonth(request: APIRequestContext): Promise<0 | -1> {
  const today = israelDay();
  if (!today.endsWith('-01')) {
    const view = { period: 'custom', from: `${today.slice(0, 8)}01`, to: addDays(today, -1) };
    const seeded = await trpcGet<{ current: { leakIls: number } }>(request, 'owner.leakSummary', { view, compare: 'off' });
    if (seeded.current.leakIls > 0) return 0;
  }
  const last = await trpcGet<{ leakIls: number }>(request, 'owner.leakHero', { monthOffset: -1 });
  expect(last.leakIls, 'the demo seed leaks this month or, in its first days, last month').toBeGreaterThan(0);
  return -1;
}

/** `?m=-1` for the leak pages (breakdown / proof) when the populated month is last month. */
export function monthQuery(offset: 0 | -1): string {
  return offset === 0 ? '' : `?m=${offset}`;
}

/** The explorer's view for that month: the default (this month) or `?p=last_month`. */
export function explorerQuery(offset: 0 | -1): string {
  return offset === 0 ? '' : '?p=last_month';
}

/** That month as YYYY-MM on the restaurant's wall clock (the monthly report's `?month=`). */
export function seededMonthKey(offset: 0 | -1, now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-')
    .map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
