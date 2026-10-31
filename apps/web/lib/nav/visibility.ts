import type { UserRole } from '@restomatch/db';
import { allowedRolesForPath } from '../roles';
import { FOOTER_GROUPS, GROUP_ORDER } from './groups';
import { ancestry, matchRoute, REGISTRY } from './registry';
import type { BarLabel, BarSlot, GroupKey, NavViewer, RouteDef } from './types';

/**
 * What a viewer can open and what nav shows them. Pure functions over the
 * registry, shared by the shell (server + client), search and the tests.
 */

/** Whether `role` may open a concrete path (the middleware gate). Unknown paths default to open. */
export function canOpenPath(role: UserRole, path: string): boolean {
  const allowed = allowedRolesForPath(path.split(/[?#]/)[0]!);
  return allowed ? allowed.includes(role) : true;
}

export function canOpen(role: UserRole, def: RouteDef): boolean {
  return canOpenPath(role, def.path);
}

/** A flag-gated route whose flags are all off 404s, so nothing should link to it. */
function flagsOn(viewer: Pick<NavViewer, 'features'>, def: RouteDef | undefined): boolean {
  return !def?.features || def.features.some((f) => viewer.features.includes(f));
}

/**
 * Whether a link to `path` leads somewhere for this viewer: the role gate lets
 * them in and, for a registered page, one of its flags is on.
 */
export function canFollowPath(viewer: Pick<NavViewer, 'role' | 'features'>, path: string): boolean {
  return canOpenPath(viewer.role, path) && flagsOn(viewer, matchRoute(path));
}

/** Visible in nav (sidebar / bar / sheet / search "מסכים") for this viewer. */
export function isNavVisible(viewer: NavViewer, def: RouteDef): boolean {
  if (def.nav !== 'item') return false;
  if (!canOpen(viewer.role, def)) return false;
  if (!flagsOn(viewer, def)) return false;
  if (def.chain === 'only' && !viewer.showChain) return false;
  if (def.chain === 'single' && viewer.showChain) return false;
  return true;
}

export function groupOf(def: RouteDef, viewer: Pick<NavViewer, 'showChain'>): GroupKey {
  return !viewer.showChain && def.groupWhenSingle ? def.groupWhenSingle : def.group;
}

const byRank = (a: RouteDef, b: RouteDef) => (a.rank ?? 100) - (b.rank ?? 100);

export interface NavGroup {
  group: GroupKey;
  items: RouteDef[];
}

/** Sidebar groups for a viewer, in job order; empty groups dropped. */
export function navGroups(viewer: NavViewer): NavGroup[] {
  const visible = REGISTRY.filter((d) => isNavVisible(viewer, d));
  return GROUP_ORDER.map((group) => ({
    group,
    items: visible.filter((d) => groupOf(d, viewer) === group).sort(byRank),
  })).filter((g) => g.items.length > 0);
}

export function mainGroups(viewer: NavViewer): NavGroup[] {
  return navGroups(viewer).filter((g) => !FOOTER_GROUPS.includes(g.group));
}

export function footerGroups(viewer: NavViewer): NavGroup[] {
  return navGroups(viewer).filter((g) => FOOTER_GROUPS.includes(g.group));
}

export interface BarItem {
  def: RouteDef;
  label: BarLabel;
  slot: BarSlot;
}

/**
 * The role's bottom bar: slots 1–4 from the registry (`bar`), "עוד" is
 * appended by the UI. A slot whose route is hidden (flag off) is dropped; when
 * two routes claim a slot, the chain-only one wins for a chain owner.
 */
export function barItems(viewer: NavViewer): BarItem[] {
  const out: BarItem[] = [];
  for (const slot of [1, 2, 3, 4] as const) {
    const candidates = REGISTRY.filter((d) => d.bar?.[viewer.role]?.slot === slot && isNavVisible(viewer, d));
    candidates.sort((a, b) => Number(b.chain === 'only') - Number(a.chain === 'only'));
    const def = candidates[0];
    if (def) out.push({ def, slot, label: def.bar![viewer.role]!.label });
  }
  return out;
}

/** The "עוד" sheet: every nav group, minus what the bar already holds. */
export function moreGroups(viewer: NavViewer): NavGroup[] {
  const inBar = new Set(barItems(viewer).map((b) => b.def.key));
  return navGroups(viewer)
    .map((g) => ({ group: g.group, items: g.items.filter((d) => !inBar.has(d.key)) }))
    .filter((g) => g.items.length > 0);
}

/** The registry entry the nav highlights for a pathname: the route itself or its nearest nav-item ancestor. */
export function activeNavKey(pathname: string): string | undefined {
  const def = matchRoute(pathname);
  if (!def) return undefined;
  return ancestry(def).find((d) => d.nav === 'item')?.key;
}

/** Field task routes (receiving a delivery, counting, ordering) run without the bottom bar. */
export function isFieldPath(pathname: string): boolean {
  return matchRoute(pathname)?.field === true;
}

export interface Crumb {
  key: string;
  /** Only when the viewer can open it and the concrete path is known. */
  href?: string;
}

/**
 * Breadcrumb trail for a pathname, root-most first, current page last. A
 * dynamic ancestor (`/suppliers/[id]`) takes its concrete path from the current
 * URL. Crumbs the viewer can't open — role gate, or a page whose flags are
 * off — carry no href (rendered as plain text).
 */
export function crumbsFor(pathname: string, viewer: Pick<NavViewer, 'role' | 'features'>): Crumb[] {
  const def = matchRoute(pathname);
  if (!def) return [];
  const segs = pathname.split(/[?#]/)[0]!.replace(/\/+$/, '').split('/');
  const chain = ancestry(def).reverse();
  return chain.map((d, i) => {
    const last = i === chain.length - 1;
    if (last) return { key: d.key };
    const pattern = d.path.split('/');
    const concrete = pattern.every((p, j) => /^\[[^\]]+\]$/.test(p) || p === segs[j])
      ? pattern.map((p, j) => (/^\[/.test(p) ? segs[j] : p)).join('/')
      : d.path.includes('[')
        ? undefined
        : d.path;
    const followable = concrete && !d.gateOnly && canOpenPath(viewer.role, concrete) && flagsOn(viewer, d);
    return { key: d.key, href: followable ? concrete : undefined };
  });
}

/**
 * Keys reachable within two interactions of the viewer's nav: every nav item,
 * plus `linked` pages whose parent is reachable. Detail pages are reached from
 * rows and search and are out of scope here.
 */
export function reachableKeys(viewer: NavViewer): Set<string> {
  const reach = new Set(navGroups(viewer).flatMap((g) => g.items.map((d) => d.key)));
  for (const d of REGISTRY) {
    if (d.nav !== 'linked' || !d.parent || !canOpen(viewer.role, d)) continue;
    if (reach.has(d.parent)) reach.add(d.key);
  }
  return reach;
}
