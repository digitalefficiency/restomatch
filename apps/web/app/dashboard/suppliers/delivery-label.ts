/**
 * "ד׳ 11/11" / "Wed 11/11" — built from numeric date parts and fixed weekday
 * labels, so server and browser render the same string (the ICU 'short'
 * weekday + day/month pattern differs between Node and Chromium: "Wed 11/11"
 * vs "Wed, 11/11" → a hydration mismatch). Pure; unit-tested.
 */
const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function deliveryDayLabel(iso: string, locale: string, tz = 'Asia/Jerusalem'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${(locale === 'he' ? HE_DAYS : EN_DAYS)[weekday]} ${dd}/${mm}`;
}
