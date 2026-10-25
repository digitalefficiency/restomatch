import type { GroupKey } from './types';

/**
 * Sidebar groups, in job order. `top` renders flat (no header); `admin` sits in
 * the sidebar footer with help and the accessibility statement.
 * Labels: `nav.groups.<key>`.
 */
export const GROUP_ORDER: readonly GroupKey[] = ['top', 'money', 'leaks', 'procure', 'kitchen', 'chain', 'admin'];

/** Groups rendered in the sidebar footer instead of the main list. */
export const FOOTER_GROUPS: readonly GroupKey[] = ['admin'];

/**
 * Groups expanded by default on desktop: every main group, so each entry is one
 * click away out of the box (the per-role defaults of lens-ia-nav §3.4 hid
 * daily items such as קבלת סחורה from the owner). The footer group (ניהול)
 * starts collapsed. The group holding the current page is always expanded, and
 * a user's own toggles persist on top of this.
 */
export function defaultOpenGroups(): GroupKey[] {
  return GROUP_ORDER.filter((g) => !FOOTER_GROUPS.includes(g));
}
