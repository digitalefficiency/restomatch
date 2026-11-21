/**
 * Window events inside the shell (DS3-02).
 *
 * NAV_POPOVERS_CLOSE: the menu is about to change presentation (Ctrl/⌘ B, `[`, the toggle, the edge, the
 * settings switch), so its popovers close first (sidebar spec §8, Ctrl/⌘ B guards) instead of staying open
 * at the place they computed for the old width. A popover that held focus gives it back to its trigger.
 */
export const NAV_POPOVERS_CLOSE = 'rm:nav-popovers-close';

export function closeNavPopovers(): void {
  window.dispatchEvent(new Event(NAV_POPOVERS_CLOSE));
}
