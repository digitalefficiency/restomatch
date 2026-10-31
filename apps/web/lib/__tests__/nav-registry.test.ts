import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS } from '@restomatch/api';
import type { UserRole } from '@restomatch/db';
import { ALL_ROLES, ROUTE_ROLES, allowedRolesForPath } from '../roles';
import { REGISTRY, ancestry, matchRoute, routeByKey } from '../nav/registry';
import {
  activeNavKey,
  barItems,
  canFollowPath,
  canOpen,
  canOpenPath,
  crumbsFor,
  isFieldPath,
  moreGroups,
  navGroups,
  reachableKeys,
} from '../nav/visibility';
import { titleFor } from '../nav/titles';
import type { NavViewer } from '../nav/types';
import { nav } from '../i18n/messages/nav';
import { createTranslator } from '../i18n/translate';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { NavProvider } from '../nav/NavProvider';
import { buildScreenOptions, normalizeSearch } from '../../app/dashboard/searchOptions';

const APP = join(__dirname, '..', '..', 'app');
const DASH = join(APP, 'dashboard');

/** Every `app/dashboard/**\/page.tsx` as a route pattern (`/dashboard/orders/[poId]`). */
function dashboardPages(dir = DASH): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name.startsWith('_')) continue;
      out.push(...dashboardPages(p));
    } else if (name === 'page.tsx') {
      const rel = relative(APP, dir).split('\\').join('/');
      // Route groups `(x)` don't add a segment.
      out.push(`/${rel.split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/')}`);
    }
  }
  return out.sort();
}

/** The demo tenant runs with every flag on. */
const ALL_FEATURES = [...FEATURE_KEYS] as string[];
const viewer = (role: UserRole, extra: Partial<NavViewer> = {}): NavViewer => ({
  role,
  features: ALL_FEATURES,
  showChain: false,
  ...extra,
});

describe('nav registry · coverage', () => {
  const pages = dashboardPages();

  it('finds the dashboard pages (sanity)', () => {
    expect(pages).toContain('/dashboard');
    expect(pages).toContain('/dashboard/orders/[poId]');
    expect(pages.length).toBeGreaterThan(40);
  });

  it('every app/dashboard/**/page.tsx is registered (exact pattern)', () => {
    const paths = new Set(REGISTRY.map((r) => r.path));
    expect(pages.filter((p) => !paths.has(p))).toEqual([]);
  });

  it('every registered page exists (gate-only prefixes and shell pages aside)', () => {
    const missing = REGISTRY.filter((r) => !r.gateOnly && r.key !== 'forbidden').filter(
      (r) => !pages.includes(r.path),
    );
    expect(missing.map((r) => r.path)).toEqual([]);
  });

  it('keys and paths are unique; parents exist; no parent cycles', () => {
    const keys = REGISTRY.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const paths = REGISTRY.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const r of REGISTRY) {
      if (r.parent) expect(routeByKey(r.parent), `${r.key}.parent`).toBeDefined();
      expect(ancestry(r).length).toBeLessThan(6);
    }
  });

  it('every entry has a he + en label, every bar label is short (≤ 8 chars)', () => {
    for (const locale of ['he', 'en'] as const) {
      const t = createTranslator(locale, nav) as (k: string) => string;
      for (const r of REGISTRY) expect(t(`links.${r.key}`), `${locale} links.${r.key}`).not.toBe(`links.${r.key}`);
      for (const r of REGISTRY) {
        for (const b of Object.values(r.bar ?? {})) {
          const label = t(`bar.${b!.label}`);
          expect(label, `bar.${b!.label}`).not.toBe(`bar.${b!.label}`);
          if (locale === 'he') expect(label.length, `bar.${b!.label} he`).toBeLessThanOrEqual(8);
        }
      }
    }
  });

  it('flags named by the registry are real feature keys', () => {
    for (const r of REGISTRY) for (const f of r.features ?? []) expect(FEATURE_KEYS).toContain(f);
  });

  it('a `linked` page is really linked from its parent page folder', () => {
    for (const r of REGISTRY.filter((x) => x.nav === 'linked')) {
      const parent = routeByKey(r.parent!)!;
      const dir = join(APP, ...parent.path.split('/').filter(Boolean));
      const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
      const linked = files.some((f) => readFileSync(join(dir, f), 'utf8').includes(r.path));
      expect(linked, `${r.path} is linked from ${parent.path}`).toBe(true);
    }
  });
});

/**
 * ROUTE_ROLES before the registry (main @ 3cf3cb7). The generated map must
 * equal it, except the listed deltas.
 */
const ROUTE_ROLES_BEFORE: Record<string, UserRole[]> = {
  '/dashboard': ALL_ROLES,
  '/dashboard/receiving': ['owner', 'manager', 'receiver'],
  '/dashboard/approvals': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/inbox': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/leaks': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/leaks/proof': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/recovery': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/reports': ['owner', 'manager'],
  '/dashboard/reports/monthly': ['owner', 'manager'],
  '/dashboard/ask': ['owner', 'manager'],
  '/dashboard/reports/digest': ['owner', 'manager'],
  '/dashboard/suppliers': ['owner', 'manager'],
  '/dashboard/suppliers/ledger': ['owner', 'manager', 'receiver', 'bookkeeper'],
  '/dashboard/catalog': ['owner', 'manager'],
  '/dashboard/products': ['owner', 'manager'],
  '/dashboard/orders': ['owner', 'manager'],
  '/dashboard/contracts': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/recipes': ['owner', 'manager', 'chef'],
  '/dashboard/inventory': ['owner', 'manager', 'chef'],
  '/dashboard/exports': ['owner', 'bookkeeper'],
  '/dashboard/integrations': ['owner', 'manager', 'bookkeeper'],
  '/dashboard/invoices': ['owner', 'manager', 'receiver', 'bookkeeper'],
  '/dashboard/team': ['owner', 'manager'],
  '/dashboard/settings': ALL_ROLES,
  '/dashboard/chain': ['owner'],
  '/dashboard/branches': ['owner'],
};

describe('ROUTE_ROLES generated from the registry', () => {
  const sorted = (m: Record<string, UserRole[]>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));

  it("equals today's map except the supplier ledger, which drops the receiver", () => {
    const { ['/dashboard/suppliers/ledger']: ledger, ...rest } = ROUTE_ROLES;
    const { ['/dashboard/suppliers/ledger']: ledgerBefore, ...restBefore } = ROUTE_ROLES_BEFORE;
    expect(sorted(rest)).toEqual(sorted(restBefore));
    // The only delta (owner decision 2026-10-25): the receiver gets no supplier ledger (₪ totals).
    expect(ledgerBefore).toContain('receiver');
    expect(ledger).toEqual(['owner', 'manager', 'bookkeeper']);
    // The printable leak report keeps inheriting /leaks (no silent bounce for the bookkeeper's button).
    expect(ROUTE_ROLES['/dashboard/leaks/report']).toBeUndefined();
    expect(allowedRolesForPath('/dashboard/leaks/report')).toContain('bookkeeper');
  });

  it('the supplier ledger gains a bookkeeper nav entry and is closed to the receiver', () => {
    expect(navGroups(viewer('bookkeeper')).flatMap((g) => g.items.map((d) => d.key))).toContain('ledger');
    expect(canOpenPath('receiver', '/dashboard/suppliers/ledger')).toBe(false);
    expect(canOpenPath('receiver', '/dashboard/suppliers/ledger?m=2026-10')).toBe(false);
  });

  it('never loosens a path compared to before, for every role and every page', () => {
    const before = (path: string): UserRole[] | null => {
      let best: { key: string; roles: UserRole[] } | null = null;
      for (const [key, roles] of Object.entries(ROUTE_ROLES_BEFORE)) {
        if ((path === key || path.startsWith(`${key}/`)) && (!best || key.length > best.key.length)) {
          best = { key, roles };
        }
      }
      return best?.roles ?? null;
    };
    for (const page of dashboardPages()) {
      const concrete = page.replace(/\[[^\]]+\]/g, 'x');
      const now = allowedRolesForPath(concrete) ?? ALL_ROLES;
      const was = before(concrete) ?? ALL_ROLES;
      for (const role of now) expect(was, `${role} on ${concrete}`).toContain(role);
    }
  });
});

describe('nav per role', () => {
  const keysOf = (v: NavViewer) => navGroups(v).flatMap((g) => g.items.map((d) => d.key));

  it('no nav entry targets a route the role cannot open', () => {
    for (const role of ALL_ROLES) {
      for (const showChain of [false, true]) {
        const v = viewer(role, { showChain: showChain && role === 'owner' });
        for (const d of navGroups(v).flatMap((g) => g.items)) expect(canOpen(role, d), `${role} → ${d.path}`).toBe(true);
        for (const b of barItems(v)) expect(canOpen(role, b.def), `${role} bar → ${b.def.path}`).toBe(true);
      }
    }
  });

  it('every allowed non-detail page is reachable in ≤ 2 interactions, per role', () => {
    for (const role of ALL_ROLES) {
      for (const showChain of role === 'owner' ? [false, true] : [false]) {
        const v = viewer(role, { showChain });
        const reach = reachableKeys(v);
        const allowed = REGISTRY.filter(
          (d) =>
            (d.nav === 'item' || d.nav === 'linked') &&
            canOpen(role, d) &&
            !(d.chain === 'only' && !showChain) &&
            !(d.chain === 'single' && showChain),
        );
        expect(allowed.filter((d) => !reach.has(d.key)).map((d) => d.path), `${role} chain=${showChain}`).toEqual([]);
      }
    }
  });

  it('pay run, supplier ledger and integrations are in nav for the right roles', () => {
    expect(keysOf(viewer('bookkeeper'))).toEqual(expect.arrayContaining(['payRun', 'ledger', 'integrations', 'claims']));
    expect(keysOf(viewer('owner'))).toEqual(expect.arrayContaining(['payRun', 'ledger', 'integrations']));
    expect(keysOf(viewer('manager'))).toEqual(expect.arrayContaining(['payRun', 'ledger', 'integrations']));
    // Owner decision (2026-10-25): the receiver sees no supplier ledger or ₪ screens.
    expect(keysOf(viewer('receiver'))).not.toContain('ledger');
    expect(barItems(viewer('receiver')).map((b) => b.def.key)).not.toContain('ledger');
    for (const role of ['receiver', 'chef'] as const) {
      expect(keysOf(viewer(role))).not.toContain('payRun');
      expect(keysOf(viewer(role))).not.toContain('integrations');
    }
  });

  it('a flag that is off hides its item (the page still 404s on its own)', () => {
    const v = viewer('bookkeeper', { features: [] });
    expect(keysOf(v)).not.toContain('payRun');
    expect(keysOf(v)).not.toContain('inbox');
    expect(keysOf(v)).toContain('approvals');
  });

  it('groups come in job order with ≤ 7 top-level groups', () => {
    const groups = navGroups(viewer('owner', { showChain: true })).map((g) => g.group);
    expect(groups).toEqual(['top', 'money', 'leaks', 'procure', 'kitchen', 'chain', 'admin']);
    // A single-branch owner finds Branches under ניהול; no chain group.
    const single = navGroups(viewer('owner'));
    expect(single.map((g) => g.group)).not.toContain('chain');
    expect(single.find((g) => g.group === 'admin')!.items.map((d) => d.key)).toContain('branches');
  });
});

describe('bottom bars', () => {
  const bar = (v: NavViewer) => barItems(v).map((b) => `${b.def.key}:${b.label}`);

  it('per-role sets (slot order, start → end)', () => {
    expect(bar(viewer('receiver'))).toEqual(['home:today', 'receiving:receipts']);
    expect(bar(viewer('chef'))).toEqual(['home:today', 'inventory:count', 'recipes:dishes']);
    expect(bar(viewer('manager'))).toEqual(['home:today', 'orders:orders', 'receiving:receive', 'approvals:approvals']);
    expect(bar(viewer('owner'))).toEqual(['home:home', 'approvals:approvals', 'leaks:leaks', 'orders:orders']);
    expect(bar(viewer('bookkeeper'))).toEqual(['home:home', 'approvals:approvals', 'payRun:payments', 'inbox:invoices']);
  });

  it('a chain owner keeps the same bar (the chain lives in "עוד")', () => {
    expect(bar(viewer('owner', { showChain: true }))).toEqual(bar(viewer('owner')));
    expect(moreGroups(viewer('owner', { showChain: true })).flatMap((g) => g.items.map((d) => d.key))).toContain('chain');
  });

  it('slots are unique per role; Settings is never in a bar', () => {
    for (const role of ALL_ROLES) {
      const items = barItems(viewer(role));
      expect(new Set(items.map((b) => b.slot)).size).toBe(items.length);
      expect(items.map((b) => b.def.key)).not.toContain('settings');
    }
  });

  it('the "עוד" sheet holds the rest and never repeats a bar item', () => {
    for (const role of ALL_ROLES) {
      const v = viewer(role);
      const inBar = barItems(v).map((b) => b.def.key);
      const more = moreGroups(v).flatMap((g) => g.items.map((d) => d.key));
      expect(more.filter((k) => inBar.includes(k))).toEqual([]);
      expect(new Set([...inBar, ...more])).toEqual(new Set(navGroups(v).flatMap((g) => g.items.map((d) => d.key))));
    }
  });
});

describe('matching, field routes, active item, crumbs, titles', () => {
  it('matches static segments before dynamic ones', () => {
    expect(matchRoute('/dashboard/orders/new')?.key).toBe('ordersNew');
    expect(matchRoute('/dashboard/orders/6c0e')?.key).toBe('orderDetail');
    expect(matchRoute('/dashboard/suppliers/ledger')?.key).toBe('ledger');
    expect(matchRoute('/dashboard/suppliers/abc/leak-card')?.key).toBe('supplierLeakCard');
    expect(matchRoute('/dashboard/')?.key).toBe('home');
    // An unregistered sub-path falls back to its nearest registered ancestor.
    expect(matchRoute('/dashboard/approvals/whatever/deeper')?.key).toBe('approvals');
  });

  it('field routes hide the bottom bar', () => {
    for (const p of ['/dashboard/receiving/abc', '/dashboard/inventory/count', '/dashboard/orders/new', '/dashboard/orders/capture']) {
      expect(isFieldPath(p), p).toBe(true);
    }
    for (const p of ['/dashboard', '/dashboard/receiving', '/dashboard/orders', '/dashboard/orders/abc']) {
      expect(isFieldPath(p), p).toBe(false);
    }
  });

  it('a detail page lights its nav parent', () => {
    expect(activeNavKey('/dashboard/invoices/abc')).toBe('inbox');
    expect(activeNavKey('/dashboard/products/abc')).toBe('catalog');
    expect(activeNavKey('/dashboard/suppliers/abc/leak-card')).toBe('suppliers');
    expect(activeNavKey('/dashboard/leaks/breakdown')).toBe('leaks');
    expect(activeNavKey('/dashboard/approvals/pay-run')).toBe('payRun');
  });

  it('crumbs: concrete dynamic parents, plain text where the role cannot open', () => {
    expect(crumbsFor('/dashboard/suppliers/abc/leak-card', viewer('owner'))).toEqual([
      { key: 'suppliers', href: '/dashboard/suppliers' },
      { key: 'supplierDetail', href: '/dashboard/suppliers/abc' },
      { key: 'supplierLeakCard' },
    ]);
    // The bookkeeper may open an invoice but not every parent of it.
    expect(crumbsFor('/dashboard/invoices/abc', viewer('receiver'))).toEqual([{ key: 'inbox' }, { key: 'invoiceDetail' }]);
    expect(crumbsFor('/dashboard/invoices/abc', viewer('bookkeeper'))[0]).toEqual({ key: 'inbox', href: '/dashboard/inbox' });
    // Flag-aware: without the ingest flags the inbox 404s, so the crumb is plain text.
    expect(crumbsFor('/dashboard/invoices/abc', viewer('owner', { features: [] }))[0]).toEqual({ key: 'inbox' });
    expect(canFollowPath(viewer('owner', { features: [] }), '/dashboard/inbox')).toBe(false);
    expect(canFollowPath(viewer('owner', { features: ['ingestEmail'] }), '/dashboard/inbox')).toBe(true);
    expect(canFollowPath(viewer('owner', { features: [] }), '/dashboard/approvals')).toBe(true);
    expect(canOpenPath('bookkeeper', '/dashboard/suppliers')).toBe(false);
    expect(canOpenPath('bookkeeper', '/dashboard/suppliers/ledger?m=2026-10')).toBe(true);
  });

  it('titles: label · branch — RestoMatch (branch only with ≥ 2 memberships)', () => {
    expect(titleFor('אישורים')).toBe('אישורים — RestoMatch');
    expect(titleFor('אישורים', 'כפר הזיתים — חיפה')).toBe('אישורים · כפר הזיתים — חיפה — RestoMatch');
  });

  it('every dashboard page gets a distinct title label (he)', () => {
    const t = createTranslator('he', nav) as (k: string) => string;
    const labels = REGISTRY.filter((r) => !r.gateOnly).map((r) => t(`links.${r.key}`));
    const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
    expect(dupes).toEqual([]);
  });
});

describe('search "מסכים"', () => {
  it('normalizes Hebrew: finals, geresh/gershayim, niqqud, case', () => {
    expect(normalizeSearch('מק״טים')).toBe(normalizeSearch('מקטימ'));
    expect(normalizeSearch('  Ledger ')).toBe('ledger');
    expect(normalizeSearch('שָׁלוֹם')).toBe('שלומ');
  });

  it('matches labels and aliases from one character, label-prefix first', () => {
    const t = createTranslator('he', nav) as (k: string) => string;
    const screens = navGroups(viewer('bookkeeper')).flatMap((g) =>
      g.items.map((d) => ({ key: d.key, href: d.path, label: t(`links.${d.key}`), aliases: d.aliases ?? [] })),
    );
    expect(buildScreenOptions('אש', screens)[0]).toMatchObject({ kind: 'screen', id: 'approvals', href: '/dashboard/approvals' });
    expect(buildScreenOptions('כרט', screens).map((o) => o.id)).toEqual(['ledger']);
    expect(buildScreenOptions('ledger', screens).map((o) => o.id)).toEqual(['ledger']);
    // Role-true: the bookkeeper has no orders screen to find.
    expect(buildScreenOptions('הזמנ', screens)).toEqual([]);
    expect(buildScreenOptions('   ', screens)).toEqual([]);
  });
});

// vitest compiles .tsx with the classic runtime (React.createElement); the app uses the automatic one.
(globalThis as unknown as { React: unknown }).React = React;
// Loosely typed: the workspace carries two @types/react copies (see lib/i18n/client.tsx).
const h = createElement as unknown as (type: unknown, props?: unknown, ...children: unknown[]) => never;

describe('PageHeader contract', () => {
  const render = (props: Parameters<typeof PageHeader>[0], v: NavViewer | null = viewer('owner')) =>
    renderToStaticMarkup(h(NavProvider, { value: v ? { ...v, branch: 'כפר הזיתים — חיפה' } : null }, h(PageHeader, props)));

  it('renders exactly one h1, defaulting to the nav label, focusable by the shell', () => {
    const html = render({ route: 'payRun' });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*tabindex="-1"[^>]*>ריצת תשלומים<\/h1>/);
  });

  it('context line: branch · period', () => {
    const html = render({ route: 'leaks', context: 'אוקטובר 2026' });
    expect(html).toContain('כפר הזיתים — חיפה');
    expect(html).toContain('אוקטובר 2026');
  });

  it('one primary, one secondary and an overflow menu at most', () => {
    const html = render({
      route: 'orders',
      title: 'הזמנות',
      primary: h('button', { 'data-p': 1 }, 'הזמנה חדשה'),
      secondary: h('button', { 'data-s': 1 }, 'מוואטסאפ'),
      overflow: [{ label: 'ייצוא', href: '/dashboard/exports' }],
    });
    expect(html.match(/data-p=/g)).toHaveLength(1);
    expect(html.match(/data-s=/g)).toHaveLength(1);
    expect(html).toContain('href="/dashboard/exports"');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('Breadcrumbs: a crumb the role cannot open is plain text', () => {
  const items = [{ label: 'ספקים', href: '/dashboard/suppliers' }, { label: 'כרטסת ספקים' }];
  const render = (role: UserRole | null) =>
    renderToStaticMarkup(
      h(NavProvider, { value: role ? { ...viewer(role), branch: null } : null }, h(Breadcrumbs, { items, label: 'פירורי לחם' })),
    );

  it('links for the owner, plain text for the bookkeeper and receiver', () => {
    expect(render('owner')).toContain('href="/dashboard/suppliers"');
    expect(render('bookkeeper')).not.toContain('href="/dashboard/suppliers"');
    expect(render('receiver')).not.toContain('href="/dashboard/suppliers"');
    expect(render('bookkeeper')).toContain('ספקים');
  });

  it('a crumb to a flagged-off page is plain text', () => {
    const html = renderToStaticMarkup(
      h(
        NavProvider,
        { value: { ...viewer('owner', { features: [] }), branch: null } },
        h(Breadcrumbs, { items: [{ label: 'נכנסות', href: '/dashboard/inbox' }, { label: 'MF-1' }], label: 'x' }),
      ),
    );
    expect(html).not.toContain('href="/dashboard/inbox"');
  });

  it('outside the dashboard (no viewer) links stay as given', () => {
    expect(render(null)).toContain('href="/dashboard/suppliers"');
  });
});
