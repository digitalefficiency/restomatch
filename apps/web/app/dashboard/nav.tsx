/**
 * The dashboard shell's client pieces (DS3-02). The side menu, the top bar, the
 * command palette mount and the phone bars live in `lib/nav/shell/*` (each a
 * client module); this file keeps the import surface the layout uses. No
 * 'use client' here on purpose: a plain re-export lets the server layout import
 * each client component from its own module.
 */
export { ShellFrame, useShellUi } from '@/lib/nav/shell/ShellFrame';
export { Sidebar } from '@/lib/nav/shell/Sidebar';
export { TopBar, TopCrumbs, PhoneSearchButton, FavouriteStar } from '@/lib/nav/shell/TopBar';
export { BottomBar, MoreSheet } from '@/lib/nav/shell/PhoneNav';
export { SUPPORT_LINKS } from '@/lib/nav/support';
export type { NavBadges } from '@/lib/components/notifications';
