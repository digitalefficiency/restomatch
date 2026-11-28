/**
 * Deep links for WhatsApp answers (WA-02). The model never writes a link: the
 * grounding check strips every URL from its prose (an injection signal), and
 * the server appends these AFTER grounding. A link is the W1-04 branch-aware
 * go-link `https://<app>/dashboard/go?r=<restaurantId>&to=<internal path>`,
 * which re-checks membership on the web before it opens the screen.
 *
 * Only internal `/dashboard…` paths produced by the agent's own tools are
 * accepted; anything else (a model-chosen href, an absolute URL in a supplier
 * name) is dropped.
 */
import { stripTrailingSlashes } from '../lib/urls';

const INTERNAL = /^\/dashboard(\/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9_=&\-]*)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_APP = 'https://app.restomatch.co.il';

export function isInternalPath(p: string): boolean {
  return INTERNAL.test(p) && !p.includes('//');
}

/** The app's public origin (https only; a non-https value falls back to the default). */
export function appOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = stripTrailingSlashes(env.APP_URL ?? env.AUTH_URL ?? env.NEXTAUTH_URL ?? DEFAULT_APP);
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && !(u.hostname === 'localhost' && env.NODE_ENV !== 'production')) return DEFAULT_APP;
    return u.origin;
  } catch {
    return DEFAULT_APP;
  }
}

/** Absolute go-link for an internal path, or null when the path is not one of ours. */
export function goLink(restaurantId: string, to: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!UUID.test(restaurantId) || !isInternalPath(to)) return null;
  const u = new URL('/dashboard/go', appOrigin(env));
  u.searchParams.set('r', restaurantId);
  u.searchParams.set('to', to);
  return u.toString();
}

/** The first `max` valid, distinct go-links for `paths` (order kept). */
export function goLinks(restaurantId: string, paths: readonly string[], max = 1, env?: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const l = goLink(restaurantId, p, env);
    if (l && !out.includes(l)) out.push(l);
    if (out.length >= max) break;
  }
  return out;
}
