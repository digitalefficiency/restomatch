/**
 * Manager home: which suppliers' order windows close later today, soonest
 * first. Reads `suppliers.order_schedule` (orderDays 0 = Sun … 6 = Sat, cutoff
 * 'HH:MM' on the restaurant's wall clock). Holidays are not modelled here, like
 * the delivery derivation (a later wave).
 */

export interface ScheduleLike {
  windows: { orderDays: number[]; cutoff: string }[];
  tz?: string;
}

export interface SupplierWithSchedule {
  id: string;
  name: string;
  nameEn?: string | null;
  orderSchedule?: ScheduleLike | null;
}

export interface TodayCutoff {
  supplierId: string;
  supplierName: string;
  supplierNameEn: string | null;
  /** 'HH:MM' local. */
  cutoff: string;
  /** Minutes from now until the cutoff (> 0). */
  minutesLeft: number;
}

function wallClock(now: Date, tz: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function todayCutoffs(suppliers: readonly SupplierWithSchedule[], now: Date, restaurantTz = 'Asia/Jerusalem'): TodayCutoff[] {
  const out: TodayCutoff[] = [];
  for (const s of suppliers) {
    const schedule = s.orderSchedule;
    if (!schedule?.windows?.length) continue;
    const { weekday, minutes } = wallClock(now, schedule.tz ?? restaurantTz);
    let best: { cutoff: string; left: number } | null = null;
    for (const w of schedule.windows) {
      if (!w.orderDays.includes(weekday)) continue;
      const [h, m] = w.cutoff.split(':').map(Number);
      const left = (h ?? 0) * 60 + (m ?? 0) - minutes;
      if (left > 0 && (!best || left < best.left)) best = { cutoff: w.cutoff, left };
    }
    if (best) out.push({ supplierId: s.id, supplierName: s.name, supplierNameEn: s.nameEn ?? null, cutoff: best.cutoff, minutesLeft: best.left });
  }
  return out.sort((a, b) => a.minutesLeft - b.minutesLeft);
}
