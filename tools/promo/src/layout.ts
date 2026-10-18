// Caption safe-zone vs device zone — the ONE layout rule for every product beat.
// Captions/headlines/callouts live only in `caption`; devices, screenshots and
// their camera moves live only in `device` (rendered inside a clip of that rect),
// so the two can never intersect. scripts/check-layout.mjs asserts it.

export type Rect = { x: number; y: number; w: number; h: number };
export type Zones = { caption: Rect; device: Rect };

export const GUTTER = 48;

export function zones(width: number, height: number, locale: 'he' | 'en'): Zones {
  if (height > width) {
    // vertical: captions in a top band, device below
    const capH = Math.round(height * 0.3);
    return {
      caption: { x: 70, y: 90, w: width - 140, h: capH - 90 },
      device: { x: 0, y: capH + GUTTER, w: width, h: height - capH - GUTTER },
    };
  }
  // landscape: captions take ~38% on the reading-start side (right in RTL, left in LTR)
  const capW = Math.round(width * 0.38);
  const margin = 80;
  const captionX = locale === 'he' ? width - capW : margin;
  const caption = { x: captionX, y: 0, w: capW - margin, h: height };
  const device =
    locale === 'he'
      ? { x: 0, y: 0, w: width - capW - GUTTER, h: height }
      : { x: margin + capW - margin + GUTTER, y: 0, w: width - capW - GUTTER, h: height };
  return { caption, device };
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
