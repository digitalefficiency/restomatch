import { describe, expect, it } from 'vitest';
import { inSafeTriangle, pointInTriangle, type Pt, type RectLike } from '../aim';

const pt = (x: number, y: number): Pt => ({ x, y });
const inside = (p: Pt, r: RectLike): boolean => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

describe('pointInTriangle', () => {
  const a = pt(0, 0);
  const b = pt(10, 0);
  const c = pt(0, 10);

  it('tells inside from outside', () => {
    expect(pointInTriangle(pt(2, 2), a, b, c)).toBe(true);
    expect(pointInTriangle(pt(6, 6), a, b, c)).toBe(false);
    expect(pointInTriangle(pt(-1, 2), a, b, c)).toBe(false);
  });

  it('counts corners and edges as inside', () => {
    for (const p of [a, b, c, pt(5, 0), pt(0, 5), pt(5, 5)]) expect(pointInTriangle(p, a, b, c)).toBe(true);
    expect(pointInTriangle(pt(5, -0.5), a, b, c)).toBe(false);
    expect(pointInTriangle(pt(5.5, 5), a, b, c)).toBe(false);
  });

  it('works for either winding', () => {
    expect(pointInTriangle(pt(2, 2), a, c, b)).toBe(true);
    expect(pointInTriangle(pt(6, 6), a, c, b)).toBe(false);
    expect(pointInTriangle(pt(5, 5), c, b, a)).toBe(true);
  });

  it('holds only the points on its segments when the triangle has no area', () => {
    const [p1, p2, p3] = [pt(0, 0), pt(10, 0), pt(20, 0)];
    expect(pointInTriangle(pt(15, 0), p1, p2, p3)).toBe(true);
    expect(pointInTriangle(pt(25, 0), p1, p2, p3)).toBe(false);
    expect(pointInTriangle(pt(5, 1), p1, p2, p3)).toBe(false);
    const dot = pt(3, 3);
    expect(pointInTriangle(pt(3, 3), dot, dot, dot)).toBe(true);
    expect(pointInTriangle(pt(3, 4), dot, dot, dot)).toBe(false);
  });

  it('never puts a non-finite coordinate inside', () => {
    expect(pointInTriangle(pt(Number.NaN, 2), a, b, c)).toBe(false);
    expect(pointInTriangle(pt(2, 2), a, pt(Number.POSITIVE_INFINITY, 0), c)).toBe(false);
  });
});

describe('inSafeTriangle (spec §7.2)', () => {
  // RTL, 1440 px viewport: the 64 px rail is on the right (x 1376–1440). The כסף tile spans y 120–168
  // and ניתוח sits below it (y 172–220). The כסף flyout opens 8 px to the left of the rail
  // (240 wide), its top 4 px above the tile, with a 44 px title row and six 32 px rows.
  const RTL_FLYOUT: RectLike = { left: 1128, right: 1368, top: 116, bottom: 362 };
  const RTL_ORIGIN = pt(1400, 160);
  const RTL_NITUACH: RectLike = { left: 1380, right: 1436, top: 172, bottom: 220 };

  // The same layout mirrored for LTR: the rail on the left (x 0–64), the flyout to its right.
  const LTR_FLYOUT: RectLike = { left: 72, right: 312, top: 116, bottom: 362 };
  const LTR_ORIGIN = pt(40, 160);
  const LTR_NITUACH: RectLike = { left: 4, right: 60, top: 172, bottom: 220 };

  it('rtl: keeps כסף along the diagonal to its last row, across the ניתוח tile', () => {
    // Toward the last row's centre (1300, 340), sampled until the pointer reaches the flyout's near edge.
    const path = Array.from({ length: 31 }, (_, i) => pt(1400 - (i + 1), 160 + 1.8 * (i + 1)));
    expect(path.some((p) => inside(p, RTL_NITUACH))).toBe(true);
    for (const p of path) expect(inSafeTriangle(p, RTL_ORIGIN, RTL_FLYOUT, 'rtl')).toBe(true);
  });

  it('ltr: keeps the flyout along the mirrored diagonal', () => {
    const path = Array.from({ length: 31 }, (_, i) => pt(40 + (i + 1), 160 + 1.8 * (i + 1)));
    expect(path.some((p) => inside(p, LTR_NITUACH))).toBe(true);
    for (const p of path) expect(inSafeTriangle(p, LTR_ORIGIN, LTR_FLYOUT, 'ltr')).toBe(true);
  });

  it('lets go when the pointer runs down the rail or away from the flyout', () => {
    expect(inSafeTriangle(pt(1400, 196), RTL_ORIGIN, RTL_FLYOUT, 'rtl')).toBe(false);
    expect(inSafeTriangle(pt(1410, 200), RTL_ORIGIN, RTL_FLYOUT, 'rtl')).toBe(false);
    expect(inSafeTriangle(pt(40, 196), LTR_ORIGIN, LTR_FLYOUT, 'ltr')).toBe(false);
    expect(inSafeTriangle(pt(30, 200), LTR_ORIGIN, LTR_FLYOUT, 'ltr')).toBe(false);
  });

  it('ends at the near edge: past it the flyout keeps itself open by hover', () => {
    expect(inSafeTriangle(pt(1300, 240), RTL_ORIGIN, RTL_FLYOUT, 'rtl')).toBe(false);
    expect(inSafeTriangle(pt(140, 240), LTR_ORIGIN, LTR_FLYOUT, 'ltr')).toBe(false);
  });

  it('stretches the near edge 12 px past the flyout top and bottom', () => {
    for (const [x, origin, flyout, dir] of [
      [1368, RTL_ORIGIN, RTL_FLYOUT, 'rtl'],
      [72, LTR_ORIGIN, LTR_FLYOUT, 'ltr'],
    ] as const) {
      expect(inSafeTriangle(pt(x, 104), origin, flyout, dir)).toBe(true); // top − 12
      expect(inSafeTriangle(pt(x, 103), origin, flyout, dir)).toBe(false);
      expect(inSafeTriangle(pt(x, 374), origin, flyout, dir)).toBe(true); // bottom + 12
      expect(inSafeTriangle(pt(x, 375), origin, flyout, dir)).toBe(false);
    }
  });

  it('takes a custom pad', () => {
    expect(inSafeTriangle(pt(1368, 115), RTL_ORIGIN, RTL_FLYOUT, 'rtl', 0)).toBe(false);
    expect(inSafeTriangle(pt(1368, 116), RTL_ORIGIN, RTL_FLYOUT, 'rtl', 0)).toBe(true);
    expect(inSafeTriangle(pt(1368, 362), RTL_ORIGIN, RTL_FLYOUT, 'rtl', 0)).toBe(true);
    expect(inSafeTriangle(pt(1368, 363), RTL_ORIGIN, RTL_FLYOUT, 'rtl', 0)).toBe(false);
    expect(inSafeTriangle(pt(1368, 92), RTL_ORIGIN, RTL_FLYOUT, 'rtl', 24)).toBe(true);
    expect(inSafeTriangle(pt(1368, 92), RTL_ORIGIN, RTL_FLYOUT, 'rtl')).toBe(false);
  });

  it('picks the near edge from the direction', () => {
    // Over the RTL flyout: outside the RTL triangle, but inside the one an LTR reading would draw to its left edge.
    const p = pt(1250, 240);
    expect(inSafeTriangle(p, RTL_ORIGIN, RTL_FLYOUT, 'rtl')).toBe(false);
    expect(inSafeTriangle(p, RTL_ORIGIN, RTL_FLYOUT, 'ltr')).toBe(true);
  });
});
