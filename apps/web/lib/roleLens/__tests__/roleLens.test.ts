import { describe, expect, it } from 'vitest';
import type { UserRole } from '@restomatch/db';
import { REGISTRY } from '../../nav/registry';
import { ALL_ROLES, ROUTE_ROLES } from '../../roles';
import {
  BOOKKEEPER_READ_ONLY_ROUTES,
  I3_PENDING_SERVER_READ,
  I3_PENDING_UI,
  I3_WRITE_ONLY_SUBPATHS,
  I3_READY,
  READ_ONLY_ROUTES,
  accessFrom,
  NEXT_STEP,
  ROLE_LENS,
  SCREEN_CLASS,
  canEverOpen,
  forbiddenModelFor,
  lensRows,
  linkableFor,
  routeAccess,
  screenClassOf,
} from '..';

/** IA-03 — one role-lens table (IA-SPEC rule 3, §6.1; owner decision I3). */

describe('ROLE_LENS encodes the owner decisions', () => {
  it('receiver: no ₪ anywhere; chef: ₪ only on orders + recipes; O/M/B: all', () => {
    expect(ROLE_LENS.receiver.money).toBe('none');
    expect(ROLE_LENS.chef.money).toBe('orders+recipes');
    for (const r of ['owner', 'manager', 'bookkeeper'] as const) expect(ROLE_LENS[r].money).toBe('all');
  });
  it('the bookkeeper reads everything but edits only money (I3, M8)', () => {
    expect(ROLE_LENS.bookkeeper.readsAll).toBe(true);
    expect(ROLE_LENS.bookkeeper.edits).toEqual(['home', 'money']);
  });
});

describe('screen classes', () => {
  it('every registry route has a known first segment', () => {
    for (const r of REGISTRY) {
      const seg = r.path.replace(/^\/dashboard\/?/, '').split('/')[0] ?? '';
      expect(SCREEN_CLASS[seg], r.path).toBeDefined();
    }
  });
  it('classifies by the first segment, query and sub-path ignored', () => {
    expect(screenClassOf('/dashboard')).toBe('home');
    expect(screenClassOf('/dashboard/leaks/breakdown?x=1')).toBe('money');
    expect(screenClassOf('/dashboard/orders/abc')).toBe('orders');
    expect(screenClassOf('/dashboard/receiving/abc')).toBe('quantities');
    // G-08 product questions: the chef answers them without ₪ (train B); the rest of catalog stays ₪.
    expect(screenClassOf('/dashboard/catalog/mapping')).toBe('quantities');
    expect(screenClassOf('/dashboard/catalog/mapping?sku=1')).toBe('quantities');
    expect(screenClassOf('/dashboard/catalog')).toBe('money');
    expect(screenClassOf('/dashboard/catalog/mappingX')).toBe('money');
  });
});

describe('lens ⇔ the route gates on main (no drift between the two sources)', () => {
  it('no route opens a ₪ screen to a role whose lens forbids it', () => {
    for (const [path, roles] of Object.entries(ROUTE_ROLES)) {
      for (const role of roles) expect(canEverOpen(role, path), `${role} on ${path}`).toBe(true);
    }
  });
  it('the receiver and the chef never reach a money-class route', () => {
    for (const [path, roles] of Object.entries(ROUTE_ROLES)) {
      if (screenClassOf(path) !== 'money') continue;
      expect(roles, path).not.toContain('receiver');
      expect(roles, path).not.toContain('chef');
    }
  });
});

describe('I3: the bookkeeper reads the 10 screens blocked to her', () => {
  it('lists exactly the 10 screens', () => {
    expect(BOOKKEEPER_READ_ONLY_ROUTES).toHaveLength(10);
  });
  it('the server-ready ones (and their sub-paths) are `read` for her', () => {
    expect(I3_READY).toEqual(['/dashboard/orders', '/dashboard/suppliers', '/dashboard/catalog', '/dashboard/products']);
    for (const p of I3_READY) {
      expect(routeAccess('bookkeeper', p), p).toBe('read');
      expect(routeAccess('bookkeeper', `${p}/x`), `${p}/x`).toBe('read');
    }
  });
  it('the 5 whose server reads reject her stay `none` until their owner ships a read procedure', () => {
    expect([...I3_READY, ...I3_PENDING_SERVER_READ, ...I3_PENDING_UI].sort()).toEqual([...BOOKKEEPER_READ_ONLY_ROUTES].sort());
    for (const p of I3_PENDING_SERVER_READ) expect(routeAccess('bookkeeper', p), p).toBe('none');
  });
  it('receiving stays closed to her until the wizard has a read-only mode (scan upload)', () => {
    expect(I3_PENDING_UI).toEqual(['/dashboard/receiving']);
    expect(routeAccess('bookkeeper', '/dashboard/receiving')).toBe('none');
    expect(routeAccess('bookkeeper', '/dashboard/receiving/abc')).toBe('none');
  });
  it('the write-only sub-pages keep their pre-I3 gate: never the bookkeeper, unchanged for the rest', () => {
    for (const p of I3_WRITE_ONLY_SUBPATHS) {
      expect(routeAccess('bookkeeper', p), p).toBe('none');
      expect(routeAccess('bookkeeper', `${p}/x`), p).toBe('none');
      expect(routeAccess('owner', p), p).toBe('edit');
      expect(routeAccess('manager', p), p).toBe('edit');
    }
    expect(routeAccess('chef', '/dashboard/orders/new')).toBe('edit');
    expect(routeAccess('bookkeeper', '/dashboard/orders/abc')).toBe('read');
  });
  it('stays `read` after the registry union line adds her to the gate', () => {
    const unioned = { ...ROUTE_ROLES, '/dashboard/orders': [...(ROUTE_ROLES['/dashboard/orders'] ?? []), 'bookkeeper' as const] };
    expect(accessFrom('bookkeeper', '/dashboard/orders/1', unioned, READ_ONLY_ROUTES)).toBe('read');
  });
  it('a deeper, stricter gate under a read-only prefix wins (no read-through)', () => {
    const gates = { ...ROUTE_ROLES, '/dashboard/suppliers/secret': ['owner' as const] };
    expect(accessFrom('bookkeeper', '/dashboard/suppliers/secret', gates, READ_ONLY_ROUTES)).toBe('none');
    expect(accessFrom('bookkeeper', '/dashboard/suppliers', gates, READ_ONLY_ROUTES)).toBe('read');
  });
  it('her own screens stay `edit`; the ledger keeps its own gate', () => {
    expect(routeAccess('bookkeeper', '/dashboard/approvals')).toBe('edit');
    expect(routeAccess('bookkeeper', '/dashboard/suppliers/ledger')).toBe('edit');
    expect(routeAccess('bookkeeper', '/dashboard/exports')).toBe('edit');
  });
  it('nothing else changes for the other roles', () => {
    for (const role of ALL_ROLES.filter((r) => r !== 'bookkeeper')) {
      for (const [path, roles] of Object.entries(ROUTE_ROLES)) {
        expect(routeAccess(role, path), `${role} ${path}`).toBe(roles.includes(role) ? 'edit' : 'none');
      }
    }
  });
  it('she can link to the monthly report from the breakdown (no lock card)', () => {
    expect(linkableFor('bookkeeper', '/dashboard/suppliers?tab=x')).toBe(true);
    // Pending server read: no link to a screen that would 500 for her.
    expect(linkableFor('bookkeeper', '/dashboard/reports/monthly?month=2026-10')).toBe(false);
  });
});

describe('fail closed on unknown segments', () => {
  it('receiver and chef get `none` on an unregistered admin-class path', () => {
    for (const p of ['/dashboard/lab', '/dashboard/ordersX', '/dashboard/unknown']) {
      expect(routeAccess('receiver', p), p).toBe('none');
      expect(linkableFor('chef', p), p).toBe(false);
    }
  });
});

describe('canEverOpen', () => {
  it('never offers ₪ screens to the receiver or owner-only screens below the owner', () => {
    expect(canEverOpen('receiver', '/dashboard/leaks')).toBe(false);
    expect(canEverOpen('receiver', '/dashboard/orders')).toBe(false);
    expect(canEverOpen('chef', '/dashboard/approvals')).toBe(false);
    expect(canEverOpen('chef', '/dashboard/recipes')).toBe(true);
    expect(canEverOpen('manager', '/dashboard/chain')).toBe(false);
    expect(canEverOpen('owner', '/dashboard/chain')).toBe(true);
  });
});

describe('403: the role\'s own next step (rule 3)', () => {
  it('every role\'s next step is open to that role', () => {
    for (const role of ALL_ROLES) expect(linkableFor(role, NEXT_STEP[role].href), role).toBe(true);
  });
  it('receiver on a ₪ screen: "לקבלת סחורה", no access request', () => {
    const m = forbiddenModelFor('receiver', '/dashboard/leaks');
    expect(m.nextStep.href).toBe('/dashboard/receiving');
    expect(m.nextStep.label.he).toBe('לקבלת סחורה');
    expect(m.offerAccessRequest).toBe(false);
  });
  it('chef on approvals: "להזמנות", no access request', () => {
    expect(forbiddenModelFor('chef', '/dashboard/approvals')).toMatchObject({ nextStep: { href: '/dashboard/orders' }, offerAccessRequest: false });
  });
  it('manager on an owner-only screen: next step, no request; on a no-₪ screen a request is fine', () => {
    expect(forbiddenModelFor('manager', '/dashboard/chain').offerAccessRequest).toBe(false);
    expect(forbiddenModelFor('receiver', '/dashboard/inventory').offerAccessRequest).toBe(true);
  });
  // The owner is never refused the home, so only the other roles apply.
  it('never sends the role back to the refused screen', () => {
    for (const role of ALL_ROLES.filter((r): r is UserRole => r !== 'owner')) {
      const from = NEXT_STEP[role].href;
      expect(forbiddenModelFor(role, from).nextStep.href, role).not.toBe(from);
    }
  });
});

describe('lensRows (team screen)', () => {
  it('one row per role, in Hebrew by default', () => {
    const rows = lensRows();
    expect(rows.map((r) => r.role)).toEqual(ALL_ROLES);
    expect(rows.find((r) => r.role === 'receiver')!.money).toBe('בלי ₪');
    expect(rows.find((r) => r.role === 'bookkeeper')!.reads).toBe('קורא את כל המסכים');
  });
  it('English labels exist for every role', () => {
    for (const r of lensRows('en')) expect(r.money).toMatch(/₪/);
  });
});
