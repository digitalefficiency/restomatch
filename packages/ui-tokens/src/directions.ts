// DS2 directions (docs/ux/ds2/DS2-SPEC.md §5.1, §6). A direction is a set of
// tier-0 values plus a few tier-1/tier-2 overrides; it never adds a role.
//
// The owner chose A · מאזן on 7.11 (OWNER-DECISIONS-0711 D1), with D6's radius
// (card 12 · control 8 · overlay 16) instead of A's tighter 8/6/12. B and C were
// not chosen and are not shipped; their value sets stay in DS2-SPEC §6.2–6.3.

import { radiusPx, ramp } from './primitives';

export type DirectionId = 'A';

/**
 * The rollout phase (VERDICT §8). Phase 1 (train α) only ADDS variables and
 * Tailwind keys: every value an existing page reads stays v1, so 0 pixels
 * change. Phase 3 (train γ/δ) makes the direction's row heights and cell
 * padding live in the shared primitives. Bump this one number to move on.
 */
export const DS2_PHASE: 1 | 2 | 3 = 2;

export interface Direction {
  id: DirectionId;
  name: string;
  /** Neutrals the direction adds on top of the v1 roles (which it keeps). */
  neutrals: { borderRule: string; textSecondaryField: string };
  radius: { xs: number; control: number; card: number; overlay: number };
  /** Table row heights per density (px); field rows use `touch`. */
  rows: { compact: number; default: number; touch: number };
  /** Horizontal cell padding per density (px). */
  cellPx: { compact: number; default: number; touch: number };
}

export const directions: Record<DirectionId, Direction> = {
  A: {
    id: 'A',
    name: 'מאזן',
    neutrals: { borderRule: ramp.neutral[150], textSecondaryField: ramp.neutral[750] },
    radius: { xs: radiusPx.xs, control: radiusPx.control, card: radiusPx.card, overlay: radiusPx.overlay },
    rows: { compact: 32, default: 44, touch: 56 },
    cellPx: { compact: 8, default: 12, touch: 16 },
  },
};

export const ACTIVE: DirectionId = 'A';

export const activeDirection: Direction = directions[ACTIVE];
