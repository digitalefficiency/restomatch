/**
 * Aim detection for rail flyouts (sidebar spec §7.2). Moving diagonally from a
 * rail tile to a row deep in its flyout crosses the neighbouring tiles; without
 * a safe zone the flyout would switch to whichever group the pointer grazes.
 * While the pointer stays inside the triangle from its last position on the
 * trigger to the flyout's near edge (padded 12 px above and below), the shell
 * keeps the open flyout and switches only after a 300 ms dwell on another tile.
 *
 * Pure geometry in viewport px (`clientX` / `clientY`, `getBoundingClientRect`);
 * no DOM, so it unit-tests without a browser.
 */

/** A point in viewport px. */
export interface Pt {
  x: number;
  y: number;
}

/** The edges of a box in viewport px; a `DOMRect` fits. */
export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Whether `p` lies inside triangle abc. Edges and corners count as inside, so
 * a pointer exactly on the padded corner keeps the flyout. Either winding
 * works. A zero-area triangle (all three corners on one line) contains only
 * the points on its segments, and a non-finite coordinate is never inside.
 */
export function pointInTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  if (![p, a, b, c].every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) return false;
  if (side(c, a, b) === 0) return onSegment(p, a, b) || onSegment(p, b, c) || onSegment(p, c, a);
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Whether the pointer `p` is still heading for the open flyout: inside the
 * triangle from `origin` (the pointer's last position on the trigger) to the
 * flyout's near edge, stretched `pad` px past its top and bottom so a slightly
 * high or low aim at the first or last row still counts. The near edge faces
 * the rail: the flyout's right edge in RTL (the rail sits on the right), its
 * left edge in LTR.
 */
export function inSafeTriangle(p: Pt, origin: Pt, flyout: RectLike, dir: 'rtl' | 'ltr', pad = 12): boolean {
  const nearX = dir === 'rtl' ? flyout.right : flyout.left;
  return pointInTriangle(p, origin, { x: nearX, y: flyout.top - pad }, { x: nearX, y: flyout.bottom + pad });
}

/** The z of (b − a) × (p − a): positive on one side of line ab, negative on the other, 0 on it. */
function side(p: Pt, a: Pt, b: Pt): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  return (
    side(p, a, b) === 0 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}
