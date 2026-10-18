import { describe, expect, it } from 'vitest';
import { pickActiveMembership, requestedRestaurantOf } from '../activeRestaurant';
import { allowedRolesForPath, canSeeRoute } from '../roles';

const rows = [
  { restaurantId: 'a', role: 'owner' },
  { restaurantId: 'b', role: 'manager' },
];

describe('pickActiveMembership (branch switch trust rule)', () => {
  it('switches to a requested branch that is one of the memberships', () => {
    expect(pickActiveMembership(rows, 'a', 'b')).toEqual(rows[1]);
  });
  it('ignores a requested branch the user is not a member of (forged session update)', () => {
    expect(pickActiveMembership(rows, 'a', 'victim')).toEqual(rows[0]);
    expect(pickActiveMembership(rows, 'b', 'victim')).toEqual(rows[1]);
  });
  it('ignores non-string requests', () => {
    expect(pickActiveMembership(rows, 'b', { restaurantId: 'a' })).toEqual(rows[1]);
    expect(pickActiveMembership(rows, 'b', 42)).toEqual(rows[1]);
  });
  it('keeps the current branch, else falls back to any membership, else none', () => {
    expect(pickActiveMembership(rows, 'b')).toEqual(rows[1]);
    expect(pickActiveMembership(rows, 'gone')).toEqual(rows[0]);
    expect(pickActiveMembership([], 'a', 'a')).toBeUndefined();
  });
  it('reads activeRestaurantId from the update payload only when it is a string', () => {
    expect(requestedRestaurantOf({ activeRestaurantId: 'b' })).toBe('b');
    expect(requestedRestaurantOf({ activeRestaurantId: 7 })).toBeUndefined();
    expect(requestedRestaurantOf(undefined)).toBeUndefined();
    expect(requestedRestaurantOf({ twoFactorTicket: 'x' })).toBeUndefined();
  });
});

describe('chain routes are owner-only', () => {
  it('only owners see /dashboard/chain and /dashboard/branches', () => {
    for (const href of ['/dashboard/chain', '/dashboard/branches']) {
      expect(allowedRolesForPath(href)).toEqual(['owner']);
      for (const role of ['manager', 'receiver', 'bookkeeper', 'chef'] as const) {
        expect(canSeeRoute(role, href)).toBe(false);
      }
    }
  });
});
