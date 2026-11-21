import { forwardRef } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { cnMerge as cn } from '../cn';

/**
 * The four glyphs DS3 drew for the product (reference/src/sprite.html: i-match, i-receipt, i-credit,
 * i-leak), on Lucide's grid and line (24 px grid, round caps and joins, `currentColor`), so they sit
 * beside the Lucide icons the product already ships. Every other icon stays Lucide.
 *
 * Each has a fill layer whose opacity is `--i-duo` (0 at rest): the two-tone state of SPEC §6.
 * Typed as `LucideIcon`, so they work with <Icon as={…}> like any Lucide glyph.
 */
const DUO = { fill: 'currentColor', fillOpacity: 'var(--i-duo, 0)', stroke: 'none' } as const;

function glyph(name: string, paths: React.ReactNode, extraClass?: string): LucideIcon {
  const Glyph = forwardRef<SVGSVGElement, LucideProps>(function Glyph(
    { color = 'currentColor', size = 24, strokeWidth = 2, absoluteStrokeWidth, className, children, ...rest },
    ref,
  ) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('lucide', `lucide-${name}`, extraClass, className)}
        {...rest}
      >
        {paths}
        {children}
      </svg>
    );
  });
  Glyph.displayName = name;
  return Glyph as unknown as LucideIcon;
}

/** Ordered · received · billed: three bars, the billed one over the line (the gap, solid). */
export const MatchGlyph = glyph(
  'rm-match',
  <>
    <path d="M16.5 4.5h4v5h-4z" style={{ fill: 'currentColor', stroke: 'none' }} />
    <path d="M3.5 9.5h4v10h-4z" />
    <path d="M10 9.5h4v10h-4z" />
    <path d="M16.5 4.5h4v15h-4z" />
  </>,
);

/** An invoice: a receipt with a torn foot. */
export const ReceiptGlyph = glyph(
  'rm-receipt',
  <>
    <path style={DUO} d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
    <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
  </>,
);

/**
 * A credit request: a document with money coming back. It shows a direction, so it is drawn for
 * LTR and mirrors in RTL (SPEC §6), like <DirIcon>.
 */
export const CreditGlyph = glyph(
  'rm-credit',
  <>
    <path style={DUO} d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4v-9h7V8z" />
    <path d="M11 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6l5 5v3" />
    <path d="M13 3v5h5" />
    <path d="M21 17h-8" />
    <path d="m16 14-3 3 3 3" />
  </>,
  'rtl:-scale-x-100',
);

/** A leak: a drop. */
export const LeakGlyph = glyph(
  'rm-leak',
  <>
    <path style={DUO} d="M12 3.5s6 6.2 6 10.6a6 6 0 0 1-12 0c0-4.4 6-10.6 6-10.6z" />
    <path d="M12 3.5s6 6.2 6 10.6a6 6 0 0 1-12 0c0-4.4 6-10.6 6-10.6z" />
    <path d="M9.5 14.6a2.6 2.6 0 0 0 2.6 2.6" />
  </>,
);

/** The glyphs with their own fill layer; for any other glyph <Icon> draws the layer itself. */
export const DUO_GLYPHS: ReadonlySet<LucideIcon> = new Set([ReceiptGlyph, CreditGlyph, LeakGlyph, MatchGlyph]);
