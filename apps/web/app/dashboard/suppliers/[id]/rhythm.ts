/** W2-11 · the order-rhythm sentence parts, on the restaurant clock, 24 h. Pure; unit-tested. */

const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function parts(iso: string, tz: string): { weekday: number; hhmm: string } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    hhmm: `${get('hour')}:${get('minute')}`,
  };
}

function dayName(weekday: number, locale: string): string {
  if (locale === 'he') return HE_DAYS[weekday] ?? '';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday] ?? '';
}

/** Minutes → "2:10" (hours:minutes), or "3 ימים" past 48 h. */
export function formatLeft(minutes: number, locale: string): string {
  if (minutes >= 48 * 60) {
    const days = Math.floor(minutes / (24 * 60));
    return locale === 'he' ? `${days} ימים` : `${days} days`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

export interface RhythmLike {
  cutoffAt: string;
  minutesLeft: number;
  deliveryAt: string;
  deliveryTime: string | null;
  tz: string;
}

/** {cutoff: "ב׳ 12:00", left: "2:10", delivery: "ג׳ 09:30"}. */
export function rhythmParts(r: RhythmLike, locale: string): { cutoff: string; left: string; delivery: string } {
  const c = parts(r.cutoffAt, r.tz);
  // deliveryAt is the START of the local delivery day; its weekday is the delivery day.
  const d = parts(r.deliveryAt, r.tz);
  return {
    cutoff: `${dayName(c.weekday, locale)} ${c.hhmm}`,
    left: formatLeft(r.minutesLeft, locale),
    delivery: r.deliveryTime ? `${dayName(d.weekday, locale)} ${r.deliveryTime}` : dayName(d.weekday, locale),
  };
}

/** "ג׳ 09:30" / "Tue 09:30" for a next delivery (start of the local delivery day + its saved time). */
export function deliveryText(d: { at: string; time: string | null }, locale: string, tz = 'Asia/Jerusalem'): string {
  const day = parts(d.at, tz);
  return d.time ? `${dayName(day.weekday, locale)} ${d.time}` : dayName(day.weekday, locale);
}
