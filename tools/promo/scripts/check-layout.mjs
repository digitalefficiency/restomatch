// Layer-1 layout assertion: for every composition size and locale, the caption
// safe-zone and the device zone do not intersect. Devices/screenshots are rendered
// inside a clip of the device zone (src/components/Stage.tsx) and captions only
// inside the caption zone, so zero intersection of the zones ⇒ zero overlap on
// every frame. Run: node --experimental-strip-types scripts/check-layout.mjs
import { zones, intersects, safeBox, inside } from '../src/layout.ts';

let fail = 0;
for (const [w, h] of [
  [1920, 1080],
  [1080, 1920],
]) {
  for (const locale of ['he', 'en']) {
    const z = zones(w, h, locale);
    const inFrame = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
    const ok = !intersects(z.caption, z.device) && inFrame(z.caption) && inFrame(z.device) && inside(z.caption, safeBox(w, h));
    console.log(`${ok ? 'PASS' : 'FAIL'} ${w}×${h} ${locale} caption=${JSON.stringify(z.caption)} device=${JSON.stringify(z.device)}`);
    if (!ok) fail = 1;
  }
}
process.exit(fail);
