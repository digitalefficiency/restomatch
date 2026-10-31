import type { BranchTargetReason } from './branchSafeTarget';
import type { ScreenKey } from './access';

/**
 * A branch switch ends in a full document navigation (the #418-safe pattern in
 * branch-actions.ts), so the "why did I land here" toast has to survive it:
 * written to sessionStorage before the navigation, read once by the new page.
 */
const KEY = 'rm:branchSwitchNotice';

export interface SwitchNotice {
  branch: string;
  reason: Exclude<BranchTargetReason, 'kept'>;
  /** parent → the screen we opened; home → the screen that was closed to the role. */
  screen: ScreenKey;
}

export function saveSwitchNotice(notice: SwitchNotice): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(notice));
  } catch {
    // Private mode / storage full: the switch still works, just without the toast.
  }
}

export function takeSwitchNotice(): SwitchNotice | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const n = JSON.parse(raw) as Partial<SwitchNotice>;
    if (typeof n.branch !== 'string' || (n.reason !== 'parent' && n.reason !== 'home') || typeof n.screen !== 'string') {
      return null;
    }
    return n as SwitchNotice;
  } catch {
    return null;
  }
}
