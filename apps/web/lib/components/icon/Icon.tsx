import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Redo2, SendHorizontal, Undo2, type LucideIcon } from 'lucide-react';
import { cnMerge as cn } from '../cn';
import { DUO_GLYPHS } from './glyphs';

/** Icon size follows the text it sits with: caption 14 · body-sm 16 · body 20 · ≥20 px text 24. */
const SIZE = { caption: 'h-3.5 w-3.5', 'body-sm': 'h-4 w-4', body: 'h-5 w-5', heading: 'h-6 w-6' } as const;
export type IconSize = keyof typeof SIZE;

/**
 * DS3 two-tone state (SPEC §6): a fill layer in the icon's own colour at `--i-duo` opacity — 0 at
 * rest, .18 for the current page (with a 2 px line), .9 for a marked favourite. Not a second colour.
 */
export type IconState = 'rest' | 'active' | 'marked';
const DUO_OF: Record<IconState, number> = { rest: 0, active: 0.18, marked: 0.9 };

/**
 * The one icon wrapper (lucide, plus the four glyphs DS3 drew for the product): a fixed 1.75
 * stroke (2 when active), sized by the text role it accompanies, decorative unless `label` is given.
 * At rest it renders exactly the glyph. In the two-tone state a glyph with its own fill layer takes
 * `--i-duo`; any other Lucide glyph gets a filled copy underneath, composited once at that opacity.
 */
export function Icon({
  as: Glyph,
  size = 'body-sm',
  label,
  state = 'rest',
  duo,
  className,
}: {
  as: LucideIcon;
  size?: IconSize;
  /** Meaningful icons only — otherwise the adjacent word carries the meaning. */
  label?: string;
  /** DS3: `active` (the current page) or `marked` (a favourite). */
  state?: IconState;
  /** Override the fill layer's opacity (0–1). */
  duo?: number;
  className?: string;
}) {
  const fill = duo ?? DUO_OF[state];
  const strokeWidth = state === 'active' ? 2 : 1.75;
  const a11y = { 'aria-hidden': label ? undefined : (true as const), 'aria-label': label, role: label ? 'img' : undefined };
  if (!fill) return <Glyph strokeWidth={strokeWidth} className={cn('shrink-0', SIZE[size], className)} {...a11y} />;
  if (DUO_GLYPHS.has(Glyph)) {
    return (
      <Glyph
        strokeWidth={strokeWidth}
        data-icon-state={state}
        className={cn('shrink-0', SIZE[size], className)}
        style={{ '--i-duo': fill } as React.CSSProperties}
        {...a11y}
      />
    );
  }
  return (
    <span data-icon-state={state} className={cn('inline-grid shrink-0', SIZE[size], className)} {...a11y}>
      <Glyph aria-hidden="true" className="col-start-1 row-start-1 h-full w-full" fill="currentColor" stroke="none" style={{ opacity: fill }} />
      <Glyph aria-hidden="true" className="col-start-1 row-start-1 h-full w-full" strokeWidth={strokeWidth} />
    </span>
  );
}

export type DirIconKind = 'forward' | 'back' | 'next' | 'prev' | 'send' | 'undo' | 'redo';

const DIR: Record<DirIconKind, LucideIcon> = {
  forward: ArrowRight,
  back: ArrowLeft,
  next: ChevronRight,
  prev: ChevronLeft,
  send: SendHorizontal,
  undo: Undo2,
  redo: Redo2,
};

/**
 * A directional icon drawn for LTR and mirrored in RTL (E2), so "forward"
 * always points the way the text reads. Replaces ad-hoc `rtl:-scale-x-100`.
 */
export function DirIcon({ kind, size = 'body-sm', label, className }: { kind: DirIconKind; size?: IconSize; label?: string; className?: string }) {
  return <Icon as={DIR[kind]} size={size} label={label} className={cn('rtl:-scale-x-100', className)} />;
}
