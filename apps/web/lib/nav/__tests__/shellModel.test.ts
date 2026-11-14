import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS } from '@restomatch/api';
import type { UserRole } from '@restomatch/db';
import { ALL_ROLES } from '../../roles';
import { badgeFor } from '../badges';
import { FOOTER_GROUPS, GROUP_ORDER } from '../groups';
import { QUEUE_HREF } from '../queue';
import { REGISTRY, routeByKey } from '../registry';
import { inSpecOrder, shellModel, type ShellItem, type ShellModel } from '../shellModel';
import type { NavViewer } from '../types';
import { VIEW_ONLY } from '../viewOnly';
import { groupOf, navGroups } from '../visibility';

/** The demo tenant runs with every flag on (as lib/__tests__/nav-registry.test.ts). */
const ALL_FEATURES = [...FEATURE_KEYS] as string[];
const viewer = (role: UserRole, extra: Partial<NavViewer> = {}): NavViewer => ({
  role,
  features: ALL_FEATURES,
  showChain: false,
  ...extra,
});

const keys = (items: readonly ShellItem[]) => items.map((i) => i.key);
/** Every item the model renders, in render order. */
const allItems = (m: ShellModel): ShellItem[] => [
  ...m.top,
  ...m.groups.flatMap((g) => g.items),
  ...m.footer.flatMap((g) => g.items),
  ...m.account,
];

/**
 * Keys whose screen or badge carries ₪ for everyone: the money, analysis and
 * chain groups, the price / contract / supplier-ledger screens, and any money
 * badge (approvals, payRun, claims). The chef's ₪ exceptions (orders, recipes)
 * are deliberately not here.
 */
const MONEY_BADGES = new Set(['approvals', 'payRun', 'claims']);
const ILS_KEYS = new Set([
  'queue',
  'contracts',
  'suppliers',
  'catalog',
  'products',
  'ledger',
  ...REGISTRY.filter((d) => d.group === 'money' || d.group === 'leaks' || d.group === 'chain' || MONEY_BADGES.has(badgeFor(d) ?? '')).map(
    (d) => d.key,
  ),
]);

const FINANCE: UserRole[] = ['owner', 'manager', 'bookkeeper'];

describe('shellModel · chef and receiver get the flat rail (§1.4)', () => {
  it('chef: home, orders, recipes, inventory; settings only in the account menu', () => {
    const m = shellModel(viewer('chef'));
    expect(m.flat).toBe(true);
    expect(keys(m.top)).toEqual(['home', 'orders', 'recipes', 'inventory']);
    expect(m.groups).toEqual([]);
    expect(m.footer).toEqual([]);
    expect(keys(m.account)).toEqual(['settings']);
  });

  it('receiver: home, receiving; settings only in the account menu', () => {
    const m = shellModel(viewer('receiver'));
    expect(m.flat).toBe(true);
    expect(keys(m.top)).toEqual(['home', 'receiving']);
    expect(m.groups).toEqual([]);
    expect(m.footer).toEqual([]);
    expect(keys(m.account)).toEqual(['settings']);
  });

  it('no ₪-bearing key leaks into a chef or receiver item (chain on or off)', () => {
    for (const role of ['chef', 'receiver'] as const) {
      for (const showChain of [false, true]) {
        const leaked = keys(allItems(shellModel(viewer(role, { showChain })))).filter((k) => ILS_KEYS.has(k));
        expect(leaked, `${role} chain=${showChain}`).toEqual([]);
      }
    }
  });

  it("flat items keep the viewer's nav group and registry path (nothing invented for the flat rail)", () => {
    for (const role of ['chef', 'receiver'] as const) {
      const v = viewer(role);
      const m = shellModel(v);
      for (const i of [...m.top, ...m.account]) {
        const def = routeByKey(i.key)!;
        expect(i.group, `${role} ${i.key}`).toBe(groupOf(def, v));
        expect(i.href, `${role} ${i.key}`).toBe(def.path);
        expect(i.viewOnly, `${role} ${i.key}`).toBe(false);
      }
    }
  });

  it('flags flow through visibility: with every flag off the chef keeps home and orders', () => {
    const m = shellModel(viewer('chef', { features: [] }));
    expect(keys(m.top)).toEqual(['home', 'orders']);
    expect(keys(m.account)).toEqual(['settings']);
  });
});

describe('shellModel · owner, manager, bookkeeper get the panel', () => {
  it('top = home, queue (לטיפולי right after בית)', () => {
    for (const role of FINANCE) {
      const m = shellModel(viewer(role));
      expect(m.flat, role).toBe(false);
      expect(keys(m.top), role).toEqual(['home', 'queue']);
      expect(m.top[1], role).toEqual<ShellItem>({ key: 'queue', href: QUEUE_HREF, group: 'top', viewOnly: false, short: 'queue' });
      expect(m.account, role).toEqual([]);
    }
  });

  it('groups come in job order, without top or a footer group; the footer holds only footer groups', () => {
    for (const role of FINANCE) {
      for (const showChain of [false, true]) {
        const m = shellModel(viewer(role, { showChain }));
        const order = m.groups.map((g) => g.group);
        expect(order, `${role} chain=${showChain}`).toEqual(GROUP_ORDER.filter((g) => order.includes(g)));
        expect(order).not.toContain('top');
        for (const g of order) expect(FOOTER_GROUPS).not.toContain(g);
        for (const g of m.footer) expect(FOOTER_GROUPS).toContain(g.group);
        expect(m.groups.every((g) => g.items.length > 0)).toBe(true);
      }
    }
  });

  it('owner groups: money, analysis, procurement, kitchen (+ chain for a chain owner)', () => {
    expect(shellModel(viewer('owner')).groups.map((g) => g.group)).toEqual(['money', 'leaks', 'procure', 'kitchen']);
    expect(shellModel(viewer('owner', { showChain: true })).groups.map((g) => g.group)).toEqual(['money', 'leaks', 'procure', 'kitchen', 'chain']);
  });

  it('a single-branch owner finds סניפים under ניהול; a chain owner under רשת', () => {
    const single = shellModel(viewer('owner'));
    const admin = single.footer.find((g) => g.group === 'admin');
    expect(keys(admin?.items ?? [])).toContain('branches');
    expect(admin?.items.find((i) => i.key === 'branches')?.group).toBe('admin');
    const chain = shellModel(viewer('owner', { showChain: true }));
    expect(keys(chain.groups.find((g) => g.group === 'chain')?.items ?? [])).toEqual(['chain', 'branches']);
  });
});

describe('shellModel · built on visibility (one source for who sees what)', () => {
  it('renders exactly navGroups, in the master-table order, plus לטיפולי for the finance roles', () => {
    for (const role of ALL_ROLES) {
      for (const showChain of [false, true]) {
        for (const features of [ALL_FEATURES, []]) {
          const v = viewer(role, { showChain, features });
          const rendered = keys(allItems(shellModel(v))).filter((k) => k !== 'queue');
          if (role === 'chef' || role === 'receiver') {
            // One flat list in table order; the flat rail moves הגדרות to the end (the account menu).
            const flat = inSpecOrder(navGroups(v).flatMap((g) => g.items)).map((d) => d.key);
            expect(rendered, `${role}`).toEqual([...flat.filter((k) => k !== 'settings'), 'settings']);
          } else {
            // Same groups, same members; rows inside a group follow SPEC §4.1.
            const expected = navGroups(v).flatMap((g) => inSpecOrder(g.items).map((d) => d.key));
            expect(rendered, `${role} chain=${showChain} flags=${features.length}`).toEqual(expected);
          }
        }
      }
    }
  });

  it('orders rows like the master table (SPEC §4.1)', () => {
    const owner = shellModel(viewer('owner', { features: ALL_FEATURES, showChain: true }));
    expect(keys(owner.groups.find((g) => g.group === 'money')?.items ?? [])).toEqual([
      'approvals',
      'inbox',
      'invoices',
      'payRun',
      'claims',
      'recovery',
      'ledger',
      'close',
      'exports',
    ]);
    expect(keys(owner.groups.find((g) => g.group === 'leaks')?.items ?? [])).toEqual(['leaks', 'monthlyReport', 'ask']);
    expect(keys(owner.groups.find((g) => g.group === 'procure')?.items ?? [])).toEqual([
      'orders',
      'receiving',
      'suppliers',
      'catalog',
      'contracts',
    ]);
    expect(keys(owner.groups.find((g) => g.group === 'kitchen')?.items ?? [])).toEqual(['recipes', 'inventory']);
    expect(keys(owner.footer.find((g) => g.group === 'admin')?.items ?? [])).toEqual(['team', 'integrations', 'settings']);
    expect(keys(owner.groups.find((g) => g.group === 'chain')?.items ?? [])).toEqual(['chain', 'branches']);
    // A single-branch owner's סניפים moves to ניהול; the table does not list it there, so it keeps
    // the registry's ניהול order (צוות first).
    const single = shellModel(viewer('owner', { features: ALL_FEATURES, showChain: false }));
    expect(keys(single.footer.find((g) => g.group === 'admin')?.items ?? [])).toEqual(['team', 'branches', 'integrations', 'settings']);
    // Chef: בית · הזמנות · מנות · ספירה (§1.4).
    expect(keys(shellModel(viewer('chef', { features: ALL_FEATURES })).top)).toEqual(['home', 'orders', 'recipes', 'inventory']);
  });

  it('inSpecOrder keeps unknown keys, in their own order, after the listed ones', () => {
    const rows = [{ key: 'zeta' }, { key: 'exports' }, { key: 'alpha' }, { key: 'approvals' }];
    expect(inSpecOrder(rows).map((r) => r.key)).toEqual(['approvals', 'exports', 'zeta', 'alpha']);
  });

  it("each item's href is its registry path and its group is the group it renders in", () => {
    for (const role of ALL_ROLES) {
      const m = shellModel(viewer(role, { showChain: role === 'owner' }));
      for (const g of [...m.groups, ...m.footer]) for (const i of g.items) expect(i.group, `${role} ${i.key}`).toBe(g.group);
      for (const i of allItems(m)) {
        if (i.key === 'queue') continue;
        expect(i.href, i.key).toBe(routeByKey(i.key)?.path);
      }
    }
  });
});

describe('shellModel · view-only eye and rail short labels', () => {
  it('the bookkeeper sees suppliers, contracts and inventory with the eye; nobody else gets one', () => {
    const bk = allItems(shellModel(viewer('bookkeeper')));
    expect(keys(bk.filter((i) => i.viewOnly)).sort()).toEqual(Object.keys(VIEW_ONLY).sort());
    for (const role of ALL_ROLES.filter((r) => r !== 'bookkeeper')) {
      expect(allItems(shellModel(viewer(role, { showChain: role === 'owner' }))).filter((i) => i.viewOnly), role).toEqual([]);
    }
  });

  it('short labels only where the rail needs the shorter word', () => {
    const owner = allItems(shellModel(viewer('owner')));
    const shorts = Object.fromEntries(owner.filter((i) => i.short).map((i) => [i.key, i.short]));
    expect(shorts).toEqual({
      home: 'home',
      queue: 'queue',
      orders: 'orders',
      receiving: 'receiving',
      contracts: 'contracts',
      recipes: 'recipes',
      inventory: 'inventory',
    });
    expect(owner.find((i) => i.key === 'approvals')).not.toHaveProperty('short');
  });
});
