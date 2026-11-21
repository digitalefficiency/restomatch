// DS2 tier 2: component dials (docs/ux/ds2/DS2-SPEC.md §2.8, §5.1). Read ONLY by
// components in apps/web/lib/components/**; the modes (modes.ts) re-bind them.
//
// Phase 1 rule: a dial that an existing component already reads (`--row-h`,
// `--control-h`, `--cell-inline`, and the `--row-*` / `--cell-px` fallbacks
// inside DataTable) keeps its v1 value, so 0 pixels change. The direction's
// values for those go live in phase 3 (`DS2_PHASE` in directions.ts).

import { activeDirection, DS2_PHASE } from './directions';
import { density } from './scale';

type Px = number;
export type DialMode = 'compact' | 'default' | 'touch' | 'field';

/** New dials (nothing reads them yet), direction A values per density × mode. */
export const dials: Record<string, Partial<Record<DialMode, Px>>> = {
  'decision-row-h': { compact: 52, default: 64 },
  // DS3 SPEC §7: a queue row's block padding, 7/8 regular → 4/5 compact (inline 12 in both).
  // DS3 departs here from DS2's "layout spacing never changes with density"; nothing reads these yet.
  'decision-row-pt': { compact: 4, default: 7 },
  'decision-row-pb': { compact: 5, default: 8 },
  'btn-h-primary': { compact: 32, default: 40, touch: 48, field: 56 },
  'chip-h': { compact: 20, default: 24, touch: 28, field: 28 },
  'count-row-h': { default: 72, field: 72 },
  'nav-item-h': { compact: 32, default: 36, touch: 44 },
  'icon-sm': { default: 14 },
  'icon-md': { compact: 14, default: 16 },
  'icon-lg': { default: 20 },
  'icon-xl': { default: 24 },
  'rail-w': { default: 4 },
  'inset-control': { default: 12, field: 16 },
};

/** `--gutter-page` by breakpoint: 16 · 24 (md) · 32 (lg). */
export const gutterPage = { base: 16, md: 24, lg: 32 } as const;

/**
 * Row heights per density as constants, so DataTable's
 * `h-[var(--row-default,48px)]` reads a token without an edit. Phase 1 publishes
 * today's heights (the fallbacks DataTable already renders); phase 3 publishes
 * the direction's.
 */
export function rowConstants(): { compact: Px; default: Px; touch: Px } {
  return DS2_PHASE >= 3
    ? activeDirection.rows
    : { compact: density.compact.row, default: density.default.row, touch: density.touch.row };
}

/** `--cell-px` per density (`--cell-inline` is its v1 alias). Same phase rule. */
export function cellPx(): { compact: Px; default: Px; touch: Px } {
  return DS2_PHASE >= 3
    ? activeDirection.cellPx
    : { compact: density.compact.cellInline, default: density.default.cellInline, touch: density.touch.cellInline };
}
