/**
 * W3-03b · the one service-worker registration: /receiver-sw.js at scope
 * /dashboard/ (the app-wide manifest scope, so the share target's POST and push
 * clicks on any dashboard card are inside it). The W2-05 registration at the
 * narrower /dashboard/receiving scope is removed so a single worker controls
 * the app. Never throws.
 */
export const SW_URL = '/receiver-sw.js';
export const SW_SCOPE = '/dashboard/';
const LEGACY_SCOPE_SUFFIX = '/dashboard/receiving';

type Reg = { scope: string; unregister(): Promise<boolean> };
export interface SwContainer {
  register(url: string, opts: { scope: string }): Promise<unknown>;
  getRegistrations?(): Promise<readonly Reg[]>;
}

export async function registerAppWorker(sw: SwContainer | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined): Promise<boolean> {
  if (!sw) return false;
  try {
    await sw.register(SW_URL, { scope: SW_SCOPE });
    const regs = (await sw.getRegistrations?.()) ?? [];
    for (const r of regs) {
      const path = new URL(r.scope, 'https://x.invalid').pathname.replace(/\/$/, '');
      if (path.endsWith(LEGACY_SCOPE_SUFFIX)) await r.unregister().catch(() => false);
    }
    return true;
  } catch {
    return false;
  }
}
