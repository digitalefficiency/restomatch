/**
 * IA warden (#274), routed to W2-11: a role that cannot write a supplier
 * (suppliers.update / setActive are managerProcedure: owner + manager) sees
 * the supplier's values read-only, never an edit form it can't submit.
 * Pure; unit-tested.
 */
export const SUPPLIER_WRITE_ROLES = ['owner', 'manager'] as const;

export function canEditSupplier(role: string | null | undefined): boolean {
  return !!role && (SUPPLIER_WRITE_ROLES as readonly string[]).includes(role);
}

export interface ScheduleWindowLike {
  orderDays: number[];
  cutoff: string;
  fulfillment: { kind: 'lead_days'; leadDays: number } | { kind: 'next_named_day'; deliversOnDay: number };
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** One order window as plain parts for a read-only line: days, cutoff, and how the delivery follows. */
export function windowParts(w: ScheduleWindowLike): {
  days: DayKey[];
  cutoff: string;
  delivery: { kind: 'lead'; days: number } | { kind: 'named'; day: DayKey };
} {
  const days = [...w.orderDays].sort((a, b) => a - b).map((d) => DAY_KEYS[d]!).filter(Boolean);
  const delivery =
    w.fulfillment.kind === 'lead_days'
      ? ({ kind: 'lead', days: w.fulfillment.leadDays } as const)
      : ({ kind: 'named', day: DAY_KEYS[w.fulfillment.deliversOnDay]! } as const);
  return { days, cutoff: w.cutoff, delivery };
}
