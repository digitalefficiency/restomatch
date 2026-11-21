/**
 * W3-03b · service-worker registrations of /receiver-sw.js. Two scopes, one
 * script (the worker reads its own scope):
 * - `/dashboard/` (app-wide, every role): share target + push + notification
 *   clicks. It never answers page navigations.
 * - `/dashboard/receiving` (W2-05, ReceiverPwa — roles that open receiving):
 *   the offline shell. The narrower scope controls the receiving pages.
 * Never throws.
 */
export const SW_URL = '/receiver-sw.js';
export const SW_SCOPE = '/dashboard/';
export const RECEIVING_SCOPE = '/dashboard/receiving';

export interface SwContainer {
  register(url: string, opts: { scope: string }): Promise<unknown>;
}

const container = (): SwContainer | undefined => (typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined);

async function reg(sw: SwContainer | undefined, scope: string): Promise<boolean> {
  if (!sw) return false;
  try {
    await sw.register(SW_URL, { scope });
    return true;
  } catch {
    return false;
  }
}

export function registerAppWorker(sw: SwContainer | undefined = container()): Promise<boolean> {
  return reg(sw, SW_SCOPE);
}
export function registerReceivingWorker(sw: SwContainer | undefined = container()): Promise<boolean> {
  return reg(sw, RECEIVING_SCOPE);
}
