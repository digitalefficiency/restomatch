import type { UserRole } from '@restomatch/db';
import { routes as approvals } from './routes/approvals';
import { routes as ask } from './routes/ask';
import { routes as branches } from './routes/branches';
import { routes as catalog } from './routes/catalog';
import { routes as chain } from './routes/chain';
import { routes as contracts } from './routes/contracts';
import { routes as exportsRoutes } from './routes/exports';
import { routes as home } from './routes/home';
import { routes as inbox } from './routes/inbox';
import { routes as integrations } from './routes/integrations';
import { routes as inventory } from './routes/inventory';
import { routes as invoices } from './routes/invoices';
import { routes as leaks } from './routes/leaks';
import { routes as orders } from './routes/orders';
import { routes as products } from './routes/products';
import { routes as receiving } from './routes/receiving';
import { routes as recipes } from './routes/recipes';
import { routes as recovery } from './routes/recovery';
import { routes as reports } from './routes/reports';
import { routes as settings } from './routes/settings';
import { routes as suppliers } from './routes/suppliers';
import { routes as system } from './routes/system';
import { routes as team } from './routes/team';
import type { RouteDef } from './types';

/**
 * The nav registry: one entry per dashboard route. It drives the sidebar, the
 * bottom bars, the "עוד" sheet, search "מסכים", titles, breadcrumbs and
 * `ROUTE_ROLES` (lib/roles.ts). Each route folder owns its `routes/<seg>.ts`.
 *
 * Order matters: it is the sidebar order inside a group.
 */
export const REGISTRY: readonly RouteDef[] = [
  ...home,
  ...system,
  // כסף: decide → pay → claim → recover → reconcile → close.
  ...approvals,
  ...inbox,
  ...invoices,
  ...leaks,
  ...recovery,
  ...suppliers,
  ...exportsRoutes,
  // דליפות
  ...reports,
  ...ask,
  // רכש
  ...orders,
  ...receiving,
  ...catalog,
  ...products,
  ...contracts,
  // מטבח
  ...recipes,
  ...inventory,
  // רשת / ניהול
  ...chain,
  ...branches,
  ...team,
  ...integrations,
  ...settings,
];

const BY_KEY = new Map(REGISTRY.map((r) => [r.key, r]));

export function routeByKey(key: string): RouteDef | undefined {
  return BY_KEY.get(key);
}

/** `/dashboard/orders/[poId]` → a regex matching `/dashboard/orders/<anything but />`. */
function patternToRegex(path: string): RegExp {
  const src = path
    .split('/')
    .map((seg) => (/^\[[^\]]+\]$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${src}/?$`);
}

const MATCHERS = REGISTRY.filter((r) => !r.gateOnly).map((r) => ({
  def: r,
  re: patternToRegex(r.path),
  // Static segments win over dynamic ones (`/orders/new` before `/orders/[poId]`).
  dynamic: (r.path.match(/\[/g) ?? []).length,
}));
MATCHERS.sort((a, b) => a.dynamic - b.dynamic);

/**
 * The registry entry for a concrete pathname (exact page match, static segments
 * first). Falls back to the nearest registered ancestor, so an unregistered
 * sub-page still gets a title and a parent.
 */
export function matchRoute(pathname: string): RouteDef | undefined {
  const clean = pathname.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  for (const m of MATCHERS) if (m.re.test(clean)) return m.def;
  const up = clean.slice(0, clean.lastIndexOf('/'));
  return up.startsWith('/dashboard') && up !== clean ? matchRoute(up) : undefined;
}

/** `[route, parent, grandparent, …]` following `parent` keys (cycle-safe). */
export function ancestry(def: RouteDef): RouteDef[] {
  const out: RouteDef[] = [def];
  let cur = def;
  while (cur.parent && out.length < 8) {
    const p = BY_KEY.get(cur.parent);
    if (!p || out.includes(p)) break;
    out.push(p);
    cur = p;
  }
  return out;
}

/**
 * `ROUTE_ROLES` generated from the registry: every entry with an explicit gate.
 * Same shape as before (exact path → roles); prefix inheritance stays in
 * `allowedRolesForPath`.
 */
export function generateRouteRoles(): Record<string, UserRole[]> {
  const out: Record<string, UserRole[]> = {};
  for (const r of REGISTRY) if (r.roles) out[r.path] = [...r.roles];
  return out;
}
