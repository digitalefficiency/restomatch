import { describe, expect, it } from 'vitest';
import type { UserRole } from '@restomatch/db';
import {
  ACT_ON,
  ROUTINGS,
  USER_ROLES,
  VISIBLE_TO,
  canActOn,
  canSee,
  expandVisibleRoles,
} from '../lib/roles';
import { CAP, CAPS, canOn, canViewPrices, capsOf, hasCap, redactPrices } from '../lib/capabilities';

/** The wave-1 implementation, copied verbatim: ACT_ON must equal it on all 30 pairs. */
function legacyExpandVisibleRoles(role: UserRole): UserRole[] {
  switch (role) {
    case 'owner':
      return ['owner', 'manager', 'bookkeeper'];
    case 'manager':
      return ['manager'];
    case 'bookkeeper':
      return ['bookkeeper'];
    default:
      return [role];
  }
}
function legacyCanActOn(role: UserRole, requiredRole: UserRole | null): boolean {
  if (!requiredRole) return role === 'owner' || role === 'manager';
  return legacyExpandVisibleRoles(role).includes(requiredRole);
}

const REQUIRED: Array<UserRole | null> = [...USER_ROLES, null];
const ctxOf = (role: UserRole, userId = 'me') => ({ session: { role, userId } });

describe('ACT_ON — who decides (byte-identical to wave 1)', () => {
  it('canActOn equals legacyCanActOn on all 5 × 6 role × requiredRole pairs', () => {
    let pairs = 0;
    for (const role of USER_ROLES) {
      for (const req of REQUIRED) {
        expect(canActOn(role, req), `${role} → ${req ?? 'unrouted'}`).toBe(legacyCanActOn(role, req));
        pairs++;
      }
    }
    expect(pairs).toBe(30);
  });

  it('the explicit table', () => {
    expect(ACT_ON).toEqual({
      owner: ['owner', 'manager', 'bookkeeper', 'unrouted'],
      manager: ['manager', 'unrouted'],
      bookkeeper: ['bookkeeper'],
      // Legacy self-routing; unreachable (the engine never routes to receiver / chef).
      receiver: ['receiver'],
      chef: ['chef'],
    });
  });

  it('expandVisibleRoles (deprecated alias) keeps returning today’s values', () => {
    for (const role of USER_ROLES) expect(expandVisibleRoles(role)).toEqual(legacyExpandVisibleRoles(role));
  });
});

describe('VISIBLE_TO — who sees (wider than who decides)', () => {
  it('owner / manager / bookkeeper see every routing; receiver / chef see none', () => {
    const table = Object.fromEntries(
      USER_ROLES.map((role) => [role, REQUIRED.map((req) => canSee(role, req))]),
    );
    // columns: owner, manager, receiver, bookkeeper, chef, unrouted
    expect(table).toEqual({
      owner: [true, true, true, true, true, true],
      manager: [true, true, true, true, true, true],
      receiver: [false, false, false, false, false, false],
      bookkeeper: [true, true, true, true, true, true],
      chef: [false, false, false, false, false, false],
    });
    expect(VISIBLE_TO.owner).toEqual(ROUTINGS);
  });

  it('seeing never implies deciding: the manager sees the owner’s ₪ but cannot decide it', () => {
    expect(canSee('manager', 'owner')).toBe(true);
    expect(canActOn('manager', 'owner')).toBe(false);
    expect(canSee('bookkeeper', null)).toBe(true);
    expect(canActOn('bookkeeper', null)).toBe(false);
    for (const role of USER_ROLES) {
      for (const req of REQUIRED) {
        if (canActOn(role, req) && role !== 'receiver' && role !== 'chef') expect(canSee(role, req)).toBe(true);
      }
    }
  });
});

describe('CAP — role matrix snapshot', () => {
  it('capsOf per role', () => {
    expect(Object.fromEntries(USER_ROLES.map((r) => [r, capsOf(r)]))).toEqual({
      owner: CAPS,
      manager: CAPS.filter((c) => !['accounting.edit', 'settings.edit', 'team.manage'].includes(c)),
      receiver: ['receipt.count'],
      bookkeeper: [
        'money.view',
        'price.view',
        'contract.view',
        'ledger.view',
        'order.view',
        'order.money.view',
        'intake.approve',
        'invoice.correct',
        'discrepancy.decide',
        'accounting.edit',
      ],
      chef: ['order.view', 'order.money.view', 'order.draft', 'order.send', 'order.cancel', 'receipt.count'],
    });
  });

  it('chef: creates, edits, sends and cancels the restaurant’s orders with no approval (owner, 31.10)', () => {
    const chef = ctxOf('chef', 'chef-1');
    for (const cap of ['order.draft', 'order.send', 'order.cancel'] as const) {
      expect(canOn(chef, cap, { createdBy: 'chef-1' })).toBe(true);
      // "orders of their own restaurant freely" — not only rows they created.
      expect(canOn(chef, cap, { createdBy: 'manager-1' })).toBe(true);
      expect(canOn(chef, cap, { createdBy: null })).toBe(true);
    }
  });

  it('chef: prices + totals on the orders screens only; no ₪ anywhere else', () => {
    expect(canViewPrices('chef', 'orders')).toBe(true);
    expect(canViewPrices('chef', 'general')).toBe(false);
    expect(canViewPrices('chef')).toBe(false);
    expect(hasCap('chef', 'money.view')).toBe(false);
    expect(hasCap('chef', 'price.view')).toBe(false);
    expect(hasCap('chef', 'contract.view')).toBe(false);
    expect(hasCap('chef', 'ledger.view')).toBe(false);
  });

  it('receiver: no ₪ anywhere, no ledger, no intake approval, no ordering', () => {
    for (const scope of ['orders', 'general'] as const) expect(canViewPrices('receiver', scope)).toBe(false);
    for (const cap of [
      'money.view',
      'price.view',
      'ledger.view',
      'intake.approve',
      'order.view',
      'order.draft',
      'order.send',
      'order.money.view',
    ] as const) {
      expect(hasCap('receiver', cap), cap).toBe(false);
    }
    expect(canOn(ctxOf('receiver'), 'order.draft', { createdBy: 'me' })).toBe(false);
  });

  it('bookkeeper: approves intake, corrects invoice lines, edits account codes; reads orders, never writes them', () => {
    for (const cap of ['intake.approve', 'invoice.correct', 'accounting.edit', 'money.view', 'ledger.view'] as const) {
      expect(hasCap('bookkeeper', cap), cap).toBe(true);
    }
    expect(hasCap('bookkeeper', 'order.view')).toBe(true);
    for (const cap of ['order.draft', 'order.send', 'order.cancel', 'settings.edit', 'team.manage'] as const) {
      expect(hasCap('bookkeeper', cap), cap).toBe(false);
    }
  });

  it('walk-in confirm is owner / manager only (decision 21); settings + team owner only', () => {
    expect(CAP['receipt.confirm_walk_in']).toEqual(['owner', 'manager']);
    expect(CAP['settings.edit']).toEqual(['owner']);
    expect(CAP['team.manage']).toEqual(['owner']);
  });
});

describe('redactPrices', () => {
  const line = { id: 'l1', name: 'עגבניות', unitPrice: '12.5000', lineTotal: '125.00', qty: 10 };

  it('orders scope: chef sees prices; receiver gets them nulled', () => {
    expect(redactPrices(ctxOf('chef'), line, ['unitPrice', 'lineTotal'], 'orders')).toBe(line);
    expect(redactPrices(ctxOf('receiver'), line, ['unitPrice', 'lineTotal'], 'orders')).toEqual({
      ...line,
      unitPrice: null,
      lineTotal: null,
    });
  });

  it('general scope (default): chef and receiver nulled; owner / manager / bookkeeper untouched', () => {
    for (const role of ['chef', 'receiver'] as const) {
      expect(redactPrices(ctxOf(role), line, ['unitPrice', 'lineTotal'])).toEqual({
        ...line,
        unitPrice: null,
        lineTotal: null,
      });
    }
    for (const role of ['owner', 'manager', 'bookkeeper'] as const) {
      expect(redactPrices(ctxOf(role), line, ['unitPrice', 'lineTotal'])).toBe(line);
    }
  });

  it('never mutates the input row', () => {
    const copy = { ...line };
    redactPrices(ctxOf('receiver'), line, ['unitPrice']);
    expect(line).toEqual(copy);
  });
});
