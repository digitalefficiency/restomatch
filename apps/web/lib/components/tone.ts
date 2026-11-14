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
 * DS3-00's roles are read by name: the brighter indicator of a dot or a bar (`*-dot`: SPEC §2
 * `--leak-solid`, `--warn-solid` with its 3:1 ring `--warn-ring`, `--ok-solid`), and `ok`, the T3
 * family by meaning (leaf green, SPEC §2 `--ok`, `--ok-sub`, `--ok-bd`). Families without an
 * indicator (info) draw with their text colour. No hex, size or shadow is written here: roles only.
 */
export type Tone = 'leak' | 'warn' | 'ok' | 'info' | 'neutral';
export type PillTone = Tone | 'solid';

/** A pill's surface and word. The word is ink on every tinted pill (SPEC §5), white on the solid one. */
export const PILL_TONE: Record<PillTone, string> = {
  leak: 'border-danger-subtle bg-danger-subtle text-fg',
  warn: 'border-warn-subtle bg-warn-subtle text-fg',
  ok: 'border-ok-subtle bg-ok-subtle text-fg',
  info: 'border-info-subtle bg-info-subtle text-fg',
  neutral: 'border-transparent bg-surface-sunken text-fg-secondary',
  solid: 'border-transparent bg-danger-bold text-on-bold',
};

/** The dot: 6 px inside a pill, 8 px beside a label. A status never relies on colour alone. */
export const DOT_TONE: Record<PillTone, string> = {
  leak: 'bg-danger-dot',
  warn: 'bg-warn-dot',
  ok: 'bg-ok-dot',
  info: 'bg-info',
  neutral: 'bg-neutral-dot',
  solid: 'bg-on-bold',
};

/**
 * The amber dot alone falls under 3:1 on white, so it carries its ring (SPEC §2 `--warn-ring`,
 * WCAG 1.4.11): 1 px outside the 6 px dot of a pill, 1.5 px inside the 8 px dot beside a label.
 */
export const WARN_RING = { pill: 'ring-1 ring-warn-dot-ring', label: 'ring-[1.5px] ring-inset ring-warn-dot-ring' } as const;

/** A word or an arrow in a meaning's colour. Never a money figure: a figure is ink, muted or green. */
export const TEXT_TONE: Record<Tone, string> = {
  leak: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ok',
  info: 'text-info',
  neutral: 'text-fg-secondary',
};

/** A tinted cell or callout with its decorative border (the off cell of a strip). */
export const SURFACE_TONE: Record<Tone, string> = {
  leak: 'border-danger-subtle bg-danger-subtle',
  warn: 'border-warn-subtle bg-warn-subtle',
  ok: 'border-ok-subtle bg-ok-subtle',
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
