import type { UserRole } from '@restomatch/db';
import type { FeatureKey } from '@restomatch/api';

/**
 * Nav registry types. Pure data, no React and no icons: `lib/roles.ts` (and so
 * the edge middleware) imports the registry, so it must stay edge-safe.
 */

/** Sidebar groups in job order (home → act → understand → operate → configure). */
export type GroupKey = 'top' | 'money' | 'leaks' | 'procure' | 'kitchen' | 'chain' | 'admin';

/**
 * How a route shows up in navigation:
 * - `item`: a sidebar / "עוד" entry (and a bottom-bar slot if `bar` says so);
 * - `linked`: a secondary page reached in one click from its `parent` page
 *   (a CTA or tab there), so it needs no nav entry of its own;
 * - `detail`: an `[id]` page reached from a list row or search;
 * - `hidden`: system pages (forbidden, gate-only prefixes) never linked from nav.
 */
export type NavKind = 'item' | 'linked' | 'detail' | 'hidden';

/** Bottom-bar short labels (≤8 chars in he; `nav.bar.*` in i18n). */
export type BarLabel =
  | 'today'
  | 'home'
  | 'approvals'
  | 'prices'
  | 'orders'
  | 'receive'
  | 'receipts'
  | 'payments'
  | 'invoices'
  | 'count'
  | 'dishes';

export type BarSlot = 1 | 2 | 3 | 4;

export interface RouteDef {
  /** Stable key; the i18n label lives at `nav.routes.<key>`. */
  key: string;
  /** Path pattern; dynamic segments as `[param]` (mirrors the app folder). */
  path: string;
  group: GroupKey;
  /** Sort order inside its group (sidebar, "עוד" sheet); lower first. */
  rank?: number;
  /** Up-link / breadcrumb parent (a registry key). */
  parent?: string;
  /**
   * Explicit role gate. Emitted into `ROUTE_ROLES`; routes without one inherit
   * the longest-prefix gate (e.g. `/leaks/breakdown` inherits `/leaks`).
   */
  roles?: readonly UserRole[];
  /** Nav visibility only: the item shows when ANY of these flags is on (the page still 404s when off). */
  features?: readonly FeatureKey[];
  /** `only`: shown only to an owner running a chain; `single`: hidden for a chain owner. */
  chain?: 'only' | 'single';
  /** Group for a single-branch owner when it differs (branches → ניהול). */
  groupWhenSingle?: GroupKey;
  nav: NavKind;
  /** Field task route: no bottom bar (focus mode). */
  field?: boolean;
  /** Bottom-bar slot per role, with its short label. */
  bar?: Partial<Record<UserRole, { slot: BarSlot; label: BarLabel }>>;
  /** Extra search terms for the "מסכים" section (the label always matches). */
  aliases?: readonly string[];
  /** A prefix gate with no page of its own (e.g. `/dashboard/reports`). */
  gateOnly?: boolean;
}

/** What the layout knows about the viewer, enough to decide what nav shows. */
export interface NavViewer {
  role: UserRole;
  /** Enabled feature flags for the active restaurant. */
  features: readonly string[];
  /** Owner with ≥2 branches on a chain plan. */
  showChain: boolean;
}
