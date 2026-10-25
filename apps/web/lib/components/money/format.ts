import { moneyStates, type MoneyState } from '@restomatch/ui-tokens';
import { formatIls } from '@/lib/money';
import type { Locale } from '@/lib/i18n/config';

/**
 * Pure helpers behind <Money> (no React — unit-tested in node). Money is only
 * ever FORMATTED here: every string comes from the frozen `formatIls()`; these
 * helpers pick its precision and split its output for styling.
 */

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

const FIGURE_CLASS = { ink: 'text-ink', muted: 'text-muted', gold: 'text-gold', primary: 'text-primary' } as const;

/** Figure colour for a money state. ₪0 is never danger: `zero` and `pending` are muted. */
export function stateClass(state: MoneyState | undefined, value: number | null): string | undefined {
  if (!state) return undefined;
  if (value === 0 && state !== 'pending') return FIGURE_CLASS.muted;
  return FIGURE_CLASS[moneyStates[state].figure];
}

/** Whole days from `today` to `due` (both read as calendar days); negative when late. */
export function daysUntil(due: Date | string, today: Date = new Date()): number {
  const d = typeof due === 'string' ? new Date(due) : due;
  const utc = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((utc(d) - utc(today)) / 86_400_000);
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
