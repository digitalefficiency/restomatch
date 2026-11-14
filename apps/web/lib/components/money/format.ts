import { moneyStates, type MoneyState } from '@restomatch/ui-tokens';
import { formatIls } from '@/lib/money';
import type { Locale } from '@/lib/i18n/config';

/**
 * Pure helpers behind <Money> (no React — unit-tested in node). Money is only
 * ever FORMATTED here: every string comes from the frozen `formatIls()`; these
 * helpers pick its precision and split its output for styling.
 */

/**
 * Owner decision (REVIEW-REPORT §8.15): numbers and ₪ in tables, tiles and
 * numeric inputs are ALWAYS physically right-aligned, in Hebrew and English
 * (R-1). The one allow-listed physical class; use it on numeric cells/values.
 */
export const NUM_ALIGN = 'text-right';

export type MoneyContext = 'hero' | 'tile' | 'line' | 'unit' | 'inline';

/** Precision contract (B3): hero/tile/inline 0 dp · line 2 dp · unit 4 dp. */
export const MONEY_DECIMALS: Record<MoneyContext, number> = {
  hero: 0,
  tile: 0,
  inline: 0,
  line: 2,
  unit: 4,
};

/** Shekels from either input. Agorot are integers (billing/pricing); /100 for display only. */
export function shekelsOf(input: { value?: number | null; agorot?: number | null }): number | null {
  if (typeof input.agorot === 'number' && Number.isFinite(input.agorot)) return input.agorot / 100;
  if (typeof input.value === 'number' && Number.isFinite(input.value)) return input.value;
  return null;
}

/** The displayed string — `formatIls()` output, unchanged. */
export function moneyText(value: number, context: MoneyContext, locale: Locale, decimals?: number): string {
  return formatIls(value, { maximumFractionDigits: decimals ?? MONEY_DECIMALS[context], locale });
}

/** The exact (2 dp) string when the displayed one is rounded, else null. */
export function exactText(value: number, shownDecimals: number, locale: Locale): string | null {
  if (shownDecimals >= 2) return null;
  const rounded = Math.round(value * 10 ** shownDecimals) / 10 ** shownDecimals;
  if (Math.abs(rounded - value) < 0.005) return null;
  return formatIls(value, { maximumFractionDigits: 2, locale });
}

/** Split a formatted string into the ₪ glyph and the rest (for the hero's smaller glyph). */
export function splitGlyph(text: string): Array<{ glyph: boolean; text: string }> {
  return text
    .split(/(₪)/)
    .filter((part) => part !== '')
    .map((part) => ({ glyph: part === '₪', text: part }));
}

export type MoneyPartKind = 'text' | 'glyph' | 'dec';
export interface MoneyPart {
  kind: MoneyPartKind;
  text: string;
}

/**
 * DS3 money markup (SPEC §3): the frozen `formatIls()` string cut into the ₪ glyph, the agorot
 * (the decimal point and what follows it) and the rest, so each can be styled while the text stays
 * byte for byte what `formatIls()` returned (`parts.map(p => p.text).join('') === text`). Both
 * display locales format through he-IL or en-GB (`intlLocaleOf`), whose decimal separator is ".";
 * with `decimals` 0 there are no agorot to cut. Anything unexpected stays plain text, never lost.
 */
export function splitMoney(text: string, decimals: number): MoneyPart[] {
  let head = text;
  let dec = '';
  let tail = '';
  if (decimals > 0) {
    const m = /^(.*\d)(\.\d+)(\D*)$/su.exec(text);
    if (m) {
      head = m[1]!;
      dec = m[2]!;
      tail = m[3]!;
    }
  }
  const out: MoneyPart[] = [];
  const pushText = (s: string) => {
    for (const p of splitGlyph(s)) out.push({ kind: p.glyph ? 'glyph' : 'text', text: p.text });
  };
  pushText(head);
  if (dec) out.push({ kind: 'dec', text: dec });
  pushText(tail);
  return out;
}

/**
 * The ₪ glyph as `formatIls()` prints it, for a unit label that names the currency without an
 * amount. Taken from the util's own output, so the glyph keeps one source.
 */
export function moneyGlyph(locale: Locale): string {
  return splitGlyph(formatIls(0, { locale })).find((p) => p.glyph)?.text ?? '';
}

/** Bidi marks and spaces Intl puts between the figure and the ₪ glyph. */
const GLYPH_JOINERS = /[\s\u00a0\u200e\u200f]+$/;

/**
 * The figure without its ₪, for a column whose ₪ sits once in the header (owner
 * decision D8, bookkeeper compact tables only). It is the frozen `formatIls()`
 * output (via `moneyText`) with the glyph and the joiners next to it removed, so
 * the digits, grouping, precision and the leading bidi marks that keep a minus
 * sign before the digits in Hebrew are exactly what an inline `<Money>` shows.
 */
export function moneyFigureText(value: number, context: MoneyContext, locale: Locale, decimals?: number): string {
  return splitGlyph(moneyText(value, context, locale, decimals))
    .filter((part) => !part.glyph)
    .map((part) => part.text)
    .join('')
    .replace(GLYPH_JOINERS, '');
}

const FIGURE_CLASS = { ink: 'text-ink', muted: 'text-muted', gold: 'text-gold', primary: 'text-primary' } as const;

/** Figure colour for a money state. ₪0 is never danger: `zero` and `pending` are muted. */
export function stateClass(state: MoneyState | undefined, value: number | null): string | undefined {
  if (!state) return undefined;
  if (value === 0 && state !== 'pending') return FIGURE_CLASS.muted;
  return FIGURE_CLASS[moneyStates[state].figure];
}

/** The Israel calendar day of an instant (or of a 'yyyy-mm-dd' date) as a UTC-midnight timestamp. */
function israelDay(value: Date | string): number {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(value),
  );
  return Date.parse(`${parts}T00:00:00Z`);
}

/**
 * Whole calendar days from `today` to `due` in Israel time (the same zone
 * formatDay prints), so the count and the printed date agree on any server or
 * browser; negative when late.
 */
export function daysUntil(due: Date | string, today: Date = new Date()): number {
  return Math.round((israelDay(due) - israelDay(today)) / 86_400_000);
}

/** DeadlineChip tone: neutral above 7 days, warn at 7 or less, danger only when late (H8). */
export function deadlineTone(days: number): 'neutral' | 'warn' | 'danger' {
  if (days < 0) return 'danger';
  if (days <= 7) return 'warn';
  return 'neutral';
}

/** `dd.MM.yyyy` in Hebrew, `dd/MM/yyyy` in English (Israel time), built from parts. */
export function formatDay(value: Date | string | number, locale: Locale): string {
  const parts = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return [get('day'), get('month'), get('year')].join(locale === 'he' ? '.' : '/');
}

export function formatClock(value: Date | string | number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
