/**
 * Where the desk panel's end edge goes (sidebar SPEC §1.6: 384 wide, "below-end of the bell"): on the bell's
 * end edge, kept 16 px inside the window and never pushed past its start edge. `bell` is the trigger's client
 * rect, `viewport` the window's client width. Pure, so it is tested without a DOM.
 */
export function bellPanelEnd(bell: { left: number; right: number }, viewport: number, rtl: boolean, width = 384, gutter = 16): number {
  const end = rtl ? bell.left : viewport - bell.right;
  const shown = Math.min(width, viewport - 2 * gutter);
  return Math.round(Math.max(gutter, Math.min(end, viewport - gutter - shown)));
}
