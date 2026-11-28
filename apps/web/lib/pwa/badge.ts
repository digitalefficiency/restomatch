/**
 * W3-03b · the app-icon badge = the number of open act-now (T2) items: the
 * danger/warn nav badges of the task spine (counts only, never ₪). Each server
 * badge may be mapped onto several routes, so values are counted once.
 */
export interface BadgeLike {
  count: number;
  tone: 'danger' | 'warn' | 'neutral';
}

export function openT2Count(badges: Partial<Record<string, BadgeLike | undefined>>): number {
  const seen = new Set<BadgeLike>();
  let n = 0;
  for (const b of Object.values(badges)) {
    if (!b || seen.has(b)) continue;
    seen.add(b);
    if (b.tone !== 'neutral' && b.count > 0) n += b.count;
  }
  return n;
}

export interface BadgeNavigator {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Set (n > 0) or clear (0) the badge where the platform supports it. Never throws. */
export async function applyAppBadge(nav: BadgeNavigator | undefined, n: number): Promise<boolean> {
  try {
    if (!nav?.setAppBadge) return false;
    if (n > 0) await nav.setAppBadge(n);
    else if (nav.clearAppBadge) await nav.clearAppBadge();
    else await nav.setAppBadge(0);
    return true;
  } catch {
    return false;
  }
}
