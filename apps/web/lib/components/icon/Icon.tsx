import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Redo2, SendHorizontal, Undo2, type LucideIcon } from 'lucide-react';
import { cnMerge as cn } from '../cn';

/** Icon size follows the text it sits with: caption 14 · body-sm 16 · body 20 · ≥20 px text 24. */
const SIZE = { caption: 'h-3.5 w-3.5', 'body-sm': 'h-4 w-4', body: 'h-5 w-5', heading: 'h-6 w-6' } as const;
export type IconSize = keyof typeof SIZE;

/**
 * The one icon wrapper (lucide only): a fixed 1.75 stroke, sized by the text
 * role it accompanies, decorative unless `label` is given.
 */
export function Icon({
  as: Glyph,
  size = 'body-sm',
  label,
  className,
}: {
  as: LucideIcon;
  size?: IconSize;
  /** Meaningful icons only — otherwise the adjacent word carries the meaning. */
  label?: string;
  className?: string;
}) {
  return (
    <Glyph
      strokeWidth={1.75}
      className={cn('shrink-0', SIZE[size], className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
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
