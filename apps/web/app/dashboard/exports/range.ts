/**
 * Calendar-date helpers for the export range (unit-tested). Dates are computed
 * in Israel time and rendered as `YYYY-MM-DD` without going through
 * `toISOString()` — that converted local midnight to UTC and made the default
 * "from" the last day of the PREVIOUS month for anyone east of UTC.
 */
const TZ = 'Asia/Jerusalem';

/** Israel-local calendar parts of an instant. */
function israelParts(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function isoDate(y: number, m: number, d: number): string {
  // Normalize overflow (e.g. month 0 → December of the previous year).
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export type RangePreset = 'thisMonth' | 'lastMonth' | 'last30' | 'thisYear';

export function presetRange(preset: RangePreset, now: Date = new Date()): { from: string; to: string } {
  const { y, m, d } = israelParts(now);
  switch (preset) {
    case 'thisMonth':
      return { from: isoDate(y, m, 1), to: isoDate(y, m, d) };
    case 'lastMonth':
      return { from: isoDate(y, m - 1, 1), to: isoDate(y, m, 0) };
    case 'last30':
      return { from: isoDate(y, m, d - 29), to: isoDate(y, m, d) };
    case 'thisYear':
      return { from: isoDate(y, 1, 1), to: isoDate(y, m, d) };
  }
}

/** null when valid, else the reason. ISO dates compare correctly as strings. */
export function rangeError(from: string, to: string): 'missing' | 'invalid' | null {
  if (!from || !to) return 'missing';
  return from > to ? 'invalid' : null;
}

/** UTF-8 BOM so Excel opens a Hebrew CSV as UTF-8 instead of mojibake. */
export function withBom(csv: string): string {
  return csv.charCodeAt(0) === 0xfeff ? csv : `﻿${csv}`;
}
