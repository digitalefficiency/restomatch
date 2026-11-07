import { computeLeakGrouped, type LeakGroupRow, type ViewSpec } from '@restomatch/charts';
import { and, asc, eq, restaurants, sql, suppliers, type Database } from '@restomatch/db';
import type { OrderSchedule } from '@restomatch/types';
import { deriveExpectedDelivery } from '../lib/deriveDelivery';

/**
 * W2-11 · the supplier page "what now, in ₪" and the owner's vendor table.
 *
 * ONE leak definition: the 90-day figure is `computeLeakGrouped(groupBy:
 * 'supplier')` over the same 90 Israel calendar days as the supplier leak card
 * (`leakCardWindow`, apps/web), i.e. exactly what `owner.leakGrouped` returns
 * for that supplier. Nothing here recomputes the leak.
 */

export const SUPPLIER_LEAK_DAYS = 90;
const DEFAULT_TZ = 'Asia/Jerusalem';

/** 'YYYY-MM-DD' of `now` on the Israel wall clock. */
function israelYmd(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The last 90 Israel calendar days, today included — the same window as the web `leakCardWindow`. */
export function supplierLeakWindow(now: Date): { from: string; to: string } {
  const to = israelYmd(now);
  const [y, m, d] = to.split('-').map(Number) as [number, number, number];
  const from = new Date(Date.UTC(y, m - 1, d - (SUPPLIER_LEAK_DAYS - 1))).toISOString().slice(0, 10);
  return { from, to };
}

const toAgorot = (ils: number): number => Math.round(ils * 100);

/** Leak still open or escalated (not waived, claimed or resolved) — the leak card's "open" figure. */
const OPEN_STATUSES = ['open', 'escalated'] as const;

function byKey(rows: LeakGroupRow[]): Map<string, LeakGroupRow> {
  return new Map(rows.map((r) => [r.key, r]));
}

export interface OrderRhythm {
  /** UTC instant of the next order cutoff. */
  cutoffAt: string;
  /** Minutes from now until that cutoff (≥ 0). */
  minutesLeft: number;
  /** UTC instant at the START of the local delivery day. */
  deliveryAt: string;
  /** 'HH:MM' from the info-only delivery schedule for that weekday, when known. */
  deliveryTime: string | null;
  tz: string;
}

type DeliveryScheduleLike = Partial<Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', string[]>> | null;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function localWeekday(at: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

/** The next order cutoff and the delivery it yields; null when the supplier has no order schedule. */
export function orderRhythm(
  schedule: OrderSchedule | null | undefined,
  deliverySchedule: DeliveryScheduleLike,
  now: Date,
  tz: string,
): OrderRhythm | null {
  const d = deriveExpectedDelivery(schedule ?? null, now, tz);
  if (!d) return null;
  const zone = schedule?.tz ?? tz;
  const day = DAY_KEYS[localWeekday(d.expectedDeliveryAt, zone)];
  const time = day ? deliverySchedule?.[day]?.[0] ?? null : null;
  return {
    cutoffAt: d.nextOrderCutoffAt.toISOString(),
    minutesLeft: Math.max(0, Math.round((d.nextOrderCutoffAt.getTime() - now.getTime()) / 60000)),
    deliveryAt: d.expectedDeliveryAt.toISOString(),
    deliveryTime: time,
    tz: zone,
  };
}

async function restaurantTz(db: Database, restaurantId: string): Promise<string> {
  const [r] = await db.select({ tz: restaurants.timezone }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  return r?.tz ?? DEFAULT_TZ;
}

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (Array.isArray(res) ? (res as Row[]) : ((res as { rows?: Row[] }).rows ?? []));

export interface SupplierOverview {
  supplierId: string;
  window: { from: string; to: string };
  /** The 90-day leak — equal to owner.leakGrouped({groupBy:'supplier'}) over `window`. */
  leakAgorot: number;
  leakCount: number;
  /** The part of it still open / escalated (not yet claimed, waived or resolved). */
  openAgorot: number;
  openCount: number;
  rhythm: OrderRhythm | null;
  /** Invoiced before VAT, per restaurant month, oldest first (6 months, current included). */
  spend: { month: string; agorot: number }[];
  /** The last 5 invoices, newest first. */
  lastInvoices: { id: string; invoiceNumber: string | null; at: string; totalAgorot: number | null; status: string }[];
}

function leakSpec(window: { from: string; to: string }, supplierIds?: string[], open = false): ViewSpec {
  return {
    period: 'custom',
    ...window,
    filters: {
      ...(supplierIds ? { supplierIds } : {}),
      ...(open ? { statuses: [...OPEN_STATUSES] } : {}),
    },
  };
}

/** One supplier's "what now" — the header ₪, the open ₪, the order rhythm, spend and the last invoices. */
export async function computeSupplierOverview(
  db: Database,
  restaurantId: string,
  supplierId: string,
  now = new Date(),
): Promise<SupplierOverview> {
  const window = supplierLeakWindow(now);
  const [leak, open, tz, sup, spendRes, lastRes] = await Promise.all([
    computeLeakGrouped(db, restaurantId, leakSpec(window, [supplierId]), 'supplier'),
    computeLeakGrouped(db, restaurantId, leakSpec(window, [supplierId], true), 'supplier'),
    restaurantTz(db, restaurantId),
    db
      .select({ orderSchedule: suppliers.orderSchedule, deliverySchedule: suppliers.deliverySchedule })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.restaurantId, restaurantId)))
      .limit(1),
    db.execute(sql`
      SELECT to_char(date_trunc('month', COALESCE(i.invoice_date, i.created_at) AT TIME ZONE r.timezone), 'YYYY-MM') AS m,
             COALESCE(SUM(i.total_excl_vat), 0) AS total
      FROM invoices i JOIN restaurants r ON r.id = i.restaurant_id
      WHERE i.restaurant_id = ${restaurantId} AND i.supplier_id = ${supplierId}
        AND COALESCE(i.invoice_date, i.created_at) AT TIME ZONE r.timezone
            >= date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE r.timezone) - interval '5 months'
      GROUP BY 1`),
    db.execute(sql`
      SELECT i.id, i.invoice_number, COALESCE(i.invoice_date, i.created_at) AS at, i.total_incl_vat, i.status
      FROM invoices i
      WHERE i.restaurant_id = ${restaurantId} AND i.supplier_id = ${supplierId}
      ORDER BY COALESCE(i.invoice_date, i.created_at) DESC, i.id
      LIMIT 5`),
  ]);
  const l = leak.find((r) => r.key === supplierId);
  const o = open.find((r) => r.key === supplierId);
  const s = sup[0];
  const spendBy = new Map(rowsOf(spendRes).map((r) => [String(r.m), toAgorot(Number(r.total))]));
  return {
    supplierId,
    window,
    leakAgorot: toAgorot(l?.leakIls ?? 0),
    leakCount: l?.count ?? 0,
    openAgorot: toAgorot(o?.leakIls ?? 0),
    openCount: o?.count ?? 0,
    rhythm: orderRhythm(s?.orderSchedule ?? null, (s?.deliverySchedule as DeliveryScheduleLike) ?? null, now, tz),
    spend: lastMonths(now, tz, 6).map((month) => ({ month, agorot: spendBy.get(month) ?? 0 })),
    lastInvoices: rowsOf(lastRes).map((r) => ({
      id: String(r.id),
      invoiceNumber: r.invoice_number == null ? null : String(r.invoice_number),
      at: new Date(r.at as string).toISOString(),
      totalAgorot: r.total_incl_vat == null ? null : toAgorot(Number(r.total_incl_vat)),
      status: String(r.status),
    })),
  };
}

/** 'YYYY-MM' keys of the last `n` months on the restaurant clock, oldest first. */
export function lastMonths(now: Date, tz: string, n: number): string[] {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .format(now)
    .split('-')
    .map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export interface SupplierTableRow {
  supplierId: string;
  name: string;
  nameEn: string | null;
  active: boolean;
  /** Invoiced before VAT this restaurant month. */
  monthSpendAgorot: number;
  /** 90-day leak (same figure as the supplier page header). */
  leakAgorot: number;
  /** Open / escalated part of the 90-day leak. */
  openAgorot: number;
  /** Start of the next delivery day (UTC ISO), from the order schedule. */
  nextDeliveryAt: string | null;
  paymentTerms: string | null;
  contactWhatsapp: string | null;
}

export interface SupplierTable {
  window: { from: string; to: string };
  rows: SupplierTableRow[];
  totals: { monthSpendAgorot: number; leakAgorot: number; openAgorot: number };
}

/**
 * The owner's vendor table: one pass for every supplier of the restaurant
 * (no per-row fetch). Sorted by the 90-day leak, biggest first; totals = Σ rows.
 */
export async function computeSupplierTable(
  db: Database,
  restaurantId: string,
  opts: { includeInactive?: boolean; now?: Date } = {},
): Promise<SupplierTable> {
  const now = opts.now ?? new Date();
  const window = supplierLeakWindow(now);
  const [list, leak, open, tz, spendRes] = await Promise.all([
    db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        nameEn: suppliers.nameEn,
        active: suppliers.active,
        orderSchedule: suppliers.orderSchedule,
        paymentTerms: suppliers.paymentTerms,
        contactWhatsapp: suppliers.contactWhatsapp,
      })
      .from(suppliers)
      .where(
        opts.includeInactive
          ? eq(suppliers.restaurantId, restaurantId)
          : and(eq(suppliers.restaurantId, restaurantId), eq(suppliers.active, true)),
      )
      .orderBy(asc(suppliers.name)),
    computeLeakGrouped(db, restaurantId, leakSpec(window), 'supplier', 'off', 1000),
    computeLeakGrouped(db, restaurantId, leakSpec(window, undefined, true), 'supplier', 'off', 1000),
    restaurantTz(db, restaurantId),
    db.execute(sql`
      SELECT i.supplier_id AS sid, COALESCE(SUM(i.total_excl_vat), 0) AS total
      FROM invoices i JOIN restaurants r ON r.id = i.restaurant_id
      WHERE i.restaurant_id = ${restaurantId} AND i.supplier_id IS NOT NULL
        AND date_trunc('month', COALESCE(i.invoice_date, i.created_at) AT TIME ZONE r.timezone)
            = date_trunc('month', ${now.toISOString()}::timestamptz AT TIME ZONE r.timezone)
      GROUP BY 1`),
  ]);
  const leakBy = byKey(leak);
  const openBy = byKey(open);
  const spendBy = new Map(rowsOf(spendRes).map((r) => [String(r.sid), toAgorot(Number(r.total))]));
  const rows: SupplierTableRow[] = list.map((s) => ({
    supplierId: s.id,
    name: s.name,
    nameEn: s.nameEn,
    active: s.active,
    monthSpendAgorot: spendBy.get(s.id) ?? 0,
    leakAgorot: toAgorot(leakBy.get(s.id)?.leakIls ?? 0),
    openAgorot: toAgorot(openBy.get(s.id)?.leakIls ?? 0),
    nextDeliveryAt: orderRhythm(s.orderSchedule, null, now, tz)?.deliveryAt ?? null,
    paymentTerms: s.paymentTerms,
    contactWhatsapp: s.contactWhatsapp,
  }));
  rows.sort((a, b) => b.leakAgorot - a.leakAgorot || a.name.localeCompare(b.name, 'he'));
  const totals = rows.reduce(
    (t, r) => ({
      monthSpendAgorot: t.monthSpendAgorot + r.monthSpendAgorot,
      leakAgorot: t.leakAgorot + r.leakAgorot,
      openAgorot: t.openAgorot + r.openAgorot,
    }),
    { monthSpendAgorot: 0, leakAgorot: 0, openAgorot: 0 },
  );
  return { window, rows, totals };
}
