/**
 * The drill contract's attributes (W2-09). A plain module (no 'use client'), so server
 * components — the heatmap tiles, report rows — can stamp them too.
 */
/** `data-*` the drill contract stamps on every door (links and buttons alike). */
export function drillAttrs(totalAgorot: number): { 'data-drill': ''; 'data-drill-total': string } {
  if (!Number.isSafeInteger(totalAgorot)) {
    throw new RangeError(`DrillLink: totalAgorot must be integer agorot, got ${totalAgorot}`);
  }
  return { 'data-drill': '', 'data-drill-total': String(totalAgorot) };
}
