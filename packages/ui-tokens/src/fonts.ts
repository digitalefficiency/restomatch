// DS2 web font stacks (docs/ux/ds2/DS2-SPEC.md §2.1.1, §5.2; FONTS.md §7).
//
// `typography.fontFamily` in index.ts is the frozen v1 export that apps/mobile
// consumes (owner decision 12), so the web stacks live here.
//
// Phase 1 (train α) publishes the role variables with today's faces, so nothing
// renders differently: --font-ui = Heebo, --font-id = today's mono stack.
// Phase 2 (train β, users see it on 24.11, D10) flips `ACTIVE_FACE` to Plex:
// --font-ui → IBM Plex Sans Hebrew with a metric-matched fallback (G13),
// --font-id → var(--font-ui) at 500 + tnum (D3, no mono), and --font-display →
// Frank Ruhl Libre for the report cover and print header only, never ₪ (D11).
// The undo is flipping `ACTIVE_FACE` back to 'heebo'.

import { family } from './primitives';

export type FaceId = 'heebo' | 'plex';

export const ACTIVE_FACE: FaceId = 'heebo';

const SYSTEM_SANS = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

export interface FontRoles {
  ui: string;
  /** Every ₪, quantity, %, count and date. Always the same family as `ui`. */
  num: string;
  /** Invoice, PO, SKU and ח״פ numbers, LTR-isolated. Never money. */
  id: string;
  /** Marketing H1, the monthly report cover and its print header. Never ₪. */
  display: string;
  featuresUi: string;
  featuresNum: string;
}

export const fontRoles: Record<FaceId, FontRoles> = {
  heebo: {
    ui: `${family.heebo}, "Inter", ${SYSTEM_SANS}`,
    num: 'var(--font-ui)',
    id: `${family.jetbrainsMono}, ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`,
    display: 'var(--font-ui)',
    featuresUi: 'normal',
    featuresNum: "'tnum' 1, 'lnum' 1",
  },
  plex: {
    ui: `${family.plexSansHebrew}, 'IBM Plex Sans Hebrew Fallback', ${SYSTEM_SANS}`,
    num: 'var(--font-ui)',
    id: 'var(--font-ui)',
    display: `${family.frankRuhlLibre}, 'Frank Ruhl Libre Fallback', serif`,
    featuresUi: 'normal',
    featuresNum: "'tnum' 1, 'lnum' 1",
  },
};

export const activeFonts: FontRoles = fontRoles[ACTIVE_FACE];
