/**
 * DS3 · the clean finish (docs/ux/ds3/SPEC.md §2, §5): the kit's status colours mapped onto
 * DS2 role classes in ONE place. Components ask for a meaning and never name a colour family:
 *
 *   leak    — leak and "blocks payment", nothing else (tinted)
 *   solid   — the one solid pill: "חוסם תשלום" (T2), white word on the leak fill
 *   warn    — a warning that waits for handling (T2 amber), a counting gap
 *   ok      — money that came back, a counted line (T3, calm green)
 *   info    — a state of the interface (selection, focus), never of money
 *   neutral — grey: the default, and everything merely pending (T4, never a warning colour)
 *
 * DS2 lacks three roles the reference draws: the brighter red of a dot or a bar (`--leak-solid`),
 * the amber dot with its 3:1 ring (`--warn-solid`, `--warn-ring`) and a green family of its own for
 * money that came back (`--ok*`). Until DS3-00 adds them the nearest DS2 role stands in here, so
 * adopting them is a change to this file only. No hex, size or shadow is written here: roles only.
 */
export type Tone = 'leak' | 'warn' | 'ok' | 'info' | 'neutral';
export type PillTone = Tone | 'solid';

/** A pill's surface and word. The word is ink on every tinted pill (SPEC §5), white on the solid one. */
export const PILL_TONE: Record<PillTone, string> = {
  leak: 'border-danger-subtle bg-danger-subtle text-fg',
  warn: 'border-warn-subtle bg-warn-subtle text-fg',
  ok: 'border-primary-subtle bg-primary-subtle text-fg',
  info: 'border-info-subtle bg-info-subtle text-fg',
  neutral: 'border-transparent bg-surface-sunken text-fg-secondary',
  solid: 'border-transparent bg-danger-bold text-on-bold',
};

/** The dot: 6 px inside a pill, 8 px beside a label. A status never relies on colour alone. */
export const DOT_TONE: Record<PillTone, string> = {
  leak: 'bg-danger-bold',
  warn: 'bg-warn-bold',
  ok: 'bg-primary-bold',
  info: 'bg-info-bold',
  neutral: 'bg-fg-tertiary',
  solid: 'bg-on-bold',
};

/** A word or an arrow in a meaning's colour. Never a money figure: a figure is ink, muted or green. */
export const TEXT_TONE: Record<Tone, string> = {
  leak: 'text-danger',
  warn: 'text-warn',
  ok: 'text-primary',
  info: 'text-info',
  neutral: 'text-fg-secondary',
};

/** A tinted cell or callout with its decorative border (the off cell of a strip). */
export const SURFACE_TONE: Record<Tone, string> = {
  leak: 'border-danger-subtle bg-danger-subtle',
  warn: 'border-warn-subtle bg-warn-subtle',
  ok: 'border-primary-subtle bg-primary-subtle',
  info: 'border-info-subtle bg-info-subtle',
  neutral: 'border-line bg-surface-sunken',
};

/** The quiet parts of a money figure: the ₪ sign and the agorot (SPEC §3). */
export const MONEY_QUIET = 'text-fg-tertiary';

/**
 * The pill's shell (SPEC §5: 12 px word, weight 500). Its height is DS2's chip role (`--chip-h`: 24 px,
 * 20 compact); SPEC §5 draws 22 — a token change requested from DS3-00, not a value written here.
 * A real border, so forced-colours mode keeps the outline (SPEC §4).
 */
export const PILL_SHELL =
  'inline-flex max-w-full items-center gap-1.5 border text-caption font-medium min-h-[var(--chip-h)] px-2';

/** The dot inside a pill. */
export const PILL_DOT = 'inline-block size-1.5 shrink-0 rounded-full forced-color-adjust-none';
