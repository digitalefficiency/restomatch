import { describe, expect, it } from 'vitest';
import type { UserRole } from '@restomatch/db';
import { REGISTRY } from '../../nav/registry';
import { ALL_ROLES, ROUTE_ROLES, allowedRolesForPath as allowedRolesForPathLocal } from '../../roles';
// G-07's capability table (not exported from @restomatch/api; it imports only a type).
import { CAP } from '../../../../../packages/api/src/lib/capabilities';
import {
  BOOKKEEPER_READ_ONLY_ROUTES,
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

describe('I3 read lens over the ONE gate (route registry; Train C #251 mechanism)', () => {
  it('lists the 10 I3 screens plus the chain matrix (display only)', () => {
    expect(BOOKKEEPER_READ_ONLY_ROUTES).toHaveLength(11);
    expect(BOOKKEEPER_READ_ONLY_ROUTES).toContain('/dashboard/chain/matrix');
  });
  it('the lens never opens a screen: where the gate refuses her, she gets `none`', () => {
    for (const p of BOOKKEEPER_READ_ONLY_ROUTES) {
      const gate = allowedRolesForPathLocal(p);
      if (gate && !gate.includes('bookkeeper')) expect(routeAccess('bookkeeper', p), p).toBe('none');
    }
  });
  it('where the gate admits her (suppliers, inventory, chain matrix), she READS', () => {
    for (const p of ['/dashboard/suppliers', '/dashboard/suppliers/abc', '/dashboard/inventory', '/dashboard/chain/matrix']) {
      expect(routeAccess('bookkeeper', p), p).toBe('read');
    }
  });
  it('a deeper route that lists her explicitly is hers to edit (ledger, order capture)', () => {
    expect(routeAccess('bookkeeper', '/dashboard/suppliers/ledger')).toBe('edit');
    expect(routeAccess('bookkeeper', '/dashboard/orders/capture')).toBe('edit');
  });
  it('her own money screens stay `edit`', () => {
    for (const p of ['/dashboard/approvals', '/dashboard/exports', '/dashboard/close', '/dashboard/invoices']) {
      expect(routeAccess('bookkeeper', p), p).toBe('edit');
    }
  });
  it('the read lens only touches the bookkeeper: every other role is edit/none exactly as the gate says', () => {
    for (const role of ALL_ROLES.filter((r) => r !== 'bookkeeper')) {
      for (const [path, roles] of Object.entries(ROUTE_ROLES)) {
        expect(routeAccess(role, path), `${role} ${path}`).toBe(roles.includes(role) ? 'edit' : 'none');
      }
    }
  });
  it('a deeper, stricter gate under a read-only prefix wins (no read-through)', () => {
    const gates = { ...ROUTE_ROLES, '/dashboard/suppliers/secret': ['owner' as const] };
    expect(accessFrom('bookkeeper', '/dashboard/suppliers/secret', gates, READ_ONLY_ROUTES)).toBe('none');
    expect(accessFrom('bookkeeper', '/dashboard/suppliers', gates, READ_ONLY_ROUTES)).toBe('read');
  });
  it('when a screen\'s route file adds her (an I3 owner PR), it reads without any lens change', () => {
    const gates = { ...ROUTE_ROLES, '/dashboard/catalog': ['owner' as const, 'manager' as const, 'bookkeeper' as const] };
    expect(accessFrom('bookkeeper', '/dashboard/catalog/abc', gates, READ_ONLY_ROUTES)).toBe('read');
    expect(accessFrom('bookkeeper', '/dashboard/catalog/abc', ROUTE_ROLES, READ_ONLY_ROUTES)).toBe('none');
  });
});

describe('lens ⇔ G-07 CAP (money)', () => {
  it('ROLE_LENS.money matches money.view / order.money.view / recipe.money.view for every role', () => {
    for (const role of ALL_ROLES) {
      const all = (CAP['money.view'] as readonly string[]).includes(role);
      const orders = (CAP['order.money.view'] as readonly string[]).includes(role);
      const recipes = (CAP['recipe.money.view'] as readonly string[]).includes(role);
      const expected = all ? 'all' : orders && recipes ? 'orders+recipes' : !orders && !recipes ? 'none' : 'mixed';
      expect(ROLE_LENS[role].money, role).toBe(expected);
    }
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
