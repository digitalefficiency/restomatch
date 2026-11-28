import type { Locale } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import type { GapSeverity, InvoiceState } from './types';

/**
 * INV-00 · how an invoice's state is drawn (SPEC §2.3): a dot or an icon and a word, never
 * colour alone; colour only when money waits for a person. The state's word is the frozen key
 * `invoices.state.<state>` (messages/invoices/he.ts, group `state`); this module holds no
 * word. Pure: it returns tone keys, never class names.
 */

/**
 * `block` · red: an open gap that blocks payment, or a possible duplicate;
 * `warn` · amber: open gaps that are all warnings;
 * `wait` · grey with a clock: being read, waiting for the count, waiting to be linked;
 * `credit` · grey with the credit icon: a credit to ask for (never green);
 * `quiet` · a quiet word, no pill: clean, approved for payment, paid.
 */
export type StateTone = 'block' | 'warn' | 'wait' | 'credit' | 'quiet';

export interface StateLook {
  tone: StateTone;
  /** Drawn as a tinted pill (false: a quiet word). */
  pill: boolean;
  /** The icon before the word, if any. */
  icon: 'clock' | 'credit' | null;
}

/**
 * The dot of a gap, a group or a place (SPEC §2.3): `block` red when a gap blocks payment,
 * `warn` amber when a person must act, `done` grey once decided, null for none. `waits`: the
 * thing waits for nothing from a person (no dot); `decided`: it was decided (grey).
 */
export function severityDot(
  worst: GapSeverity | null,
  opts: { decided?: boolean; waits?: boolean } = {},
): 'block' | 'warn' | 'done' | null {
  void worst;
  void opts;
  return null; // slice 4
}

/** The key of a state's word in the `invoices` messages (the frozen group `state`). */
export function stateKey<S extends InvoiceState>(state: S): `state.${S}` {
  return `state.${state}`;
}

/**
 * How a state is drawn. `worstSeverity` is the worst severity of the invoice's open gaps
 * (`holding.worstSeverity`), which colours "פער פתוח": red when one blocks payment, amber when
 * all are warnings.
 */
export function stateLook(state: InvoiceState, worstSeverity: GapSeverity | null): StateLook {
  void state;
  void worstSeverity;
  return { tone: 'quiet', pill: false, icon: null }; // slice 4
}

/**
 * dd.MM.yyyy on the restaurant's calendar (`timeZone`, the payload's `timeZone`) in both
 * locales (owner spec); '' for no date.
 */
export function ddmmyyyy(value: Date | string | null | undefined, locale: Locale, timeZone: string): string {
  if (value == null || value === '') return '';
  return formatDate(value, locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).replace(/\//g, '.');
}

/** dd.MM.yyyy · HH:mm on the restaurant's calendar and clock (`timeZone`). */
export function ddmmyyyyHHmm(value: Date | string | null | undefined, locale: Locale, timeZone: string): string {
  void value;
  void locale;
  void timeZone;
  return ''; // slice 4
}
