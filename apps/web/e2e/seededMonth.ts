import { expect, type APIRequestContext } from '@playwright/test';

/**
 * The month the demo seed populated, as a `monthOffset` (0 = this month, -1 = last month).
 *
 * The e2e seed dates everything from today (DEMO_TODAY defaults to today in Asia/Jerusalem) and
 * invoices only deliveries before today. So in the first days of a month the app's current month
 * honestly holds little or no leak yet: the seed's last invoiced deliveries are last month's.
 * Specs that assert on "a populated month" read that month: the current one once it leaks,
 * otherwise the previous one. They never assert less; they assert on the month that has data.
 */
export async function seededLeakMonth(request: APIRequestContext): Promise<0 | -1> {
  const leakIls = async (monthOffset: 0 | -1): Promise<number> => {
    const input = encodeURIComponent(JSON.stringify({ json: { monthOffset } }));
    const res = await request.get(`/api/trpc/owner.leakHero?input=${input}`);
    expect(res.status(), 'owner.leakHero').toBe(200);
    return ((await res.json()) as { result: { data: { json: { leakIls: number } } } }).result.data.json.leakIls;
  };
  if ((await leakIls(0)) > 0) return 0;
  expect(await leakIls(-1), 'the demo seed leaks this month or, in its first days, last month').toBeGreaterThan(0);
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
