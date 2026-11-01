import { expect, type APIRequestContext } from '@playwright/test';
import { PROOF_TOP } from '../lib/leakProof';
import { DEMO_RESTAURANT_NAME } from './env';
import { e2eSql } from './helpers';

/**
 * Month-start safety for the leak specs.
 *
 * The e2e seed dates everything from today (DEMO_TODAY defaults to today in Asia/Jerusalem) and
 * invoices only deliveries BEFORE today. So in a month's first days the app's current month holds
 * little or none of the seed's leak — at most a few rows other specs create today, which lack the
 * seed's mix. Specs that assert on "a populated month" read the month the seed populated.
 *
 * Which month that is, is decided by an ORACLE the product does not compute — raw SQL over the
 * seed's own discrepancy rows — never by the leak queries under test (owner.leakHero, leakSummary,
 * leakBreakdown). The product is then asserted against the oracle: if the seed leaked this month,
 * the hero must show a leak; a regression that empties the month fails instead of moving the
 * spec to last month.
 */

const TZ = 'Asia/Jerusalem';

export interface SeedMonthFacts {
  /** Leak findings (warn/block, not PRICE_LOWER / UNORDERED_ARRIVAL, ≠ ₪0) on the demo tenant. */
  leakFindings: number;
  /** Invoices carrying at least one of those findings. */
  leakInvoices: number;
  /** ₪0 findings on those invoices (the breakdown's calm "line-no-money" notes). */
  zeroFindings: number;
}

/**
 * The seed's facts for a month on the Israel wall clock: offset 0 = this month's invoices dated
 * from the 1st up to the START of today (the seed never invoices today); -1 = all of last month.
 */
export async function seedMonthFacts(offset: 0 | -1, now = new Date()): Promise<SeedMonthFacts> {
  const sql = e2eSql();
  try {
    const at = now.toISOString();
    const [row] = await sql<Array<{ leak_findings: number; leak_invoices: number; zero_findings: number }>>`
      with b as (
        select
          (date_trunc('month', ${at}::timestamptz at time zone ${TZ}) + make_interval(months => ${offset}::int)) at time zone ${TZ} as lo,
          case when ${offset}::int = 0
            then date_trunc('day', ${at}::timestamptz at time zone ${TZ}) at time zone ${TZ}
            else date_trunc('month', ${at}::timestamptz at time zone ${TZ}) at time zone ${TZ}
          end as hi
      ),
      d as (
        select d.delta_amount, d.severity, d.type, d.resolution_status, i.id as invoice_id
        from discrepancies d
        join match_runs mr on mr.id = d.match_run_id
        join invoices i on i.id = mr.invoice_id
        join restaurants r on r.id = i.restaurant_id
        cross join b
        where r.name = ${DEMO_RESTAURANT_NAME} and i.invoice_date >= b.lo and i.invoice_date < b.hi
      ),
      leak as (
        select * from d
        where severity in ('warn', 'block')
          and type not in ('PRICE_LOWER', 'UNORDERED_ARRIVAL')
          and not (type = 'DUPLICATE_INVOICE' and resolution_status = 'rejected')
          and abs(coalesce(delta_amount, 0)) > 0
      )
      select
        (select count(*)::int from leak) as leak_findings,
        (select count(distinct invoice_id)::int from leak) as leak_invoices,
        (select count(*)::int from d where abs(coalesce(delta_amount, 0)) < 0.005
           and invoice_id in (select invoice_id from leak)) as zero_findings`;
    return { leakFindings: row!.leak_findings, leakInvoices: row!.leak_invoices, zeroFindings: row!.zero_findings };
  } finally {
    await sql.end();
  }
}

const israelMonth = (t: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(t));

/**
 * A run that crosses Israel midnight at month end would pick "this month" on one side and read
 * the pages on the other: when the month turns within 45 s, wait until 1 s past the boundary.
 */
async function settleMonthBoundary(): Promise<void> {
  const start = Date.now();
  if (israelMonth(start) === israelMonth(start + 45_000)) return;
  while (israelMonth(Date.now()) === israelMonth(start)) await new Promise((r) => setTimeout(r, 250));
  await new Promise((r) => setTimeout(r, 1_000));
}

async function heroLeakIls(request: APIRequestContext, monthOffset: 0 | -1): Promise<number> {
  const input = encodeURIComponent(JSON.stringify({ json: { monthOffset } }));
  const res = await request.get(`/api/trpc/owner.leakHero?input=${input}`);
  expect(res.status(), 'owner.leakHero').toBe(200);
  return ((await res.json()) as { result: { data: { json: { leakIls: number } } } }).result.data.json.leakIls;
}

/** The facts a spec needs from "a populated month". `mix`: the seed's full mix (W1-08 breakdown/proof). */
function populated(f: SeedMonthFacts, mix: boolean): boolean {
  if (f.leakFindings === 0) return false;
  return !mix || (f.zeroFindings > 0 && f.leakInvoices > PROOF_TOP);
}

/**
 * The month the seed populated, as a `monthOffset` (0 = this month, -1 = last month), decided by
 * the oracle above — and the product asserted against it. `mix` asks for the seed's full mix: a
 * ₪0 finding and more leaking invoices than the proof's top catches.
 */
export async function seededLeakMonth(request: APIRequestContext, opts: { mix?: boolean } = {}): Promise<0 | -1> {
  const mix = opts.mix ?? false;
  await settleMonthBoundary();
  const thisMonth = await seedMonthFacts(0);
  if (thisMonth.leakFindings > 0) {
    // The seed leaked this month (before today): the hero must count it, whatever the spec needs.
    expect(await heroLeakIls(request, 0), `oracle: the seed leaked this month (${thisMonth.leakFindings} findings) → the hero must show it`).toBeGreaterThan(0);
  }
  if (populated(thisMonth, mix)) return 0;
  const lastMonth = await seedMonthFacts(-1);
  expect(populated(lastMonth, mix), `oracle: the seed populated last month ${JSON.stringify(lastMonth)}`).toBe(true);
  expect(await heroLeakIls(request, -1), 'oracle: the seed leaked last month → the hero must show it').toBeGreaterThan(0);
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
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-')
    .map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
