/**
 * Per-device nav preferences. The rail lives in a cookie so the server renders
 * the sidebar at its final width (no shift); localStorage mirrors it. The
 * group open/closed state is localStorage only.
 */
export const RAIL_COOKIE = 'rm_nav_rail';
export const RAIL_STORAGE = 'rm:nav:rail';
export const GROUPS_STORAGE = 'rm:nav:groups';
