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

/** What placing the panel needs from its <dialog> (an HTMLDialogElement has all of it). */
export interface PlaceableDialog {
  readonly open: boolean;
  readonly style: { insetInlineEnd: string };
  getBoundingClientRect(): { left: number; right: number };
}

/**
 * Writes the panel's `inset-inline-end`. Once the dialog is open (laid out, not yet painted) it measures where
 * the panel landed and corrects any gap between client coordinates and the box a fixed dialog is placed in,
 * such as a page scrollbar on the left (Firefox under a right-to-left interface). Returns the inset written.
 */
export function placeBellPanel(d: PlaceableDialog, bell: { left: number; right: number }, viewport: number, rtl: boolean): number {
  const end = bellPanelEnd(bell, viewport, rtl);
  d.style.insetInlineEnd = `${end}px`;
  if (!d.open) return end;
  const landed = d.getBoundingClientRect();
  const drift = (rtl ? landed.left : viewport - landed.right) - end;
  if (Math.abs(drift) < 0.5) return end;
  const fixed = Math.round(end - drift);
  d.style.insetInlineEnd = `${fixed}px`;
  return fixed;
}
