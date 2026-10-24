// Caption safe-zone vs device zone — the ONE layout rule for every product beat.
// Captions/headlines/callouts live only in `caption`; devices, screenshots and
// their camera moves live only in `device` (rendered inside a clip of that rect),
// so the two can never intersect. scripts/check-layout.mjs asserts it.

export type Rect = { x: number; y: number; w: number; h: number };
export type Zones = { caption: Rect; device: Rect };

export const GUTTER = 48;

/** 90% title-safe box (5% margin each side): every text box must stay inside it. */
export const SAFE = 0.05;
export const safeBox = (width: number, height: number): Rect => ({
  x: Math.round(width * SAFE),
  y: Math.round(height * SAFE),
  w: Math.round(width * (1 - 2 * SAFE)),
  h: Math.round(height * (1 - 2 * SAFE)),
});

export const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

export function zones(width: number, height: number, locale: 'he' | 'en'): Zones {
  if (height > width) {
    // vertical: captions in a top band, device below
    const capH = Math.round(height * 0.3);
    const m = Math.round(width * SAFE);
    return {
      caption: { x: m, y: Math.round(height * SAFE), w: width - 2 * m, h: capH - Math.round(height * SAFE) },
      device: { x: 0, y: capH + GUTTER, w: width, h: height - capH - GUTTER },
    };
  }
  // landscape: captions take ~38% on the reading-start side (right in RTL, left in LTR)
  const capW = Math.round(width * 0.38);
  const margin = Math.round(width * SAFE); // title-safe
  const captionX = locale === 'he' ? width - capW : margin;
  const caption = { x: captionX, y: Math.round(height * SAFE), w: capW - margin, h: Math.round(height * (1 - 2 * SAFE)) };
  // device zone ends at the title-safe margin on the outer side, so a pushed-in spotlight
  // (and the text inside it) never crosses the 5% safe edge
  const device =
    locale === 'he'
      ? { x: margin, y: 0, w: width - capW - GUTTER - margin, h: height }
      : { x: capW + GUTTER, y: 0, w: width - capW - GUTTER - margin, h: height };
  return { caption, device };
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
