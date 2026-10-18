import { describe, expect, it } from 'vitest';
import { ALL_ROLES, allowedRolesForPath, canSeeRoute, labelForRole } from '../roles';

/** The role matrix the nav, middleware and page guards all share. */
describe('roles matrix', () => {
  it('every role can reach Settings (personal password / 2FA / language / DSR)', () => {
    for (const role of ALL_ROLES) {
      expect(canSeeRoute(role, '/dashboard/settings')).toBe(true);
      expect(allowedRolesForPath('/dashboard/settings')).toContain(role);
    }
  });

  it('Team is owner + manager only', () => {
    expect(allowedRolesForPath('/dashboard/team')).toEqual(['owner', 'manager']);
    for (const role of ['receiver', 'bookkeeper', 'chef'] as const) {
      expect(canSeeRoute(role, '/dashboard/team')).toBe(false);
    }
  });

  it('receiver stays least-privilege (overview + receiving + settings)', () => {
    expect(canSeeRoute('receiver', '/dashboard/receiving')).toBe(true);
    expect(canSeeRoute('receiver', '/dashboard/approvals')).toBe(false);
    expect(canSeeRoute('receiver', '/dashboard/exports')).toBe(false);
    expect(allowedRolesForPath('/dashboard/receiving/abc')).toContain('receiver');
  });

  it('product pages follow the catalog (owner + manager only)', () => {
    expect(allowedRolesForPath('/dashboard/products')).toEqual(['owner', 'manager']);
    expect(allowedRolesForPath('/dashboard/products/abc')).toEqual(['owner', 'manager']);
    for (const role of ['receiver', 'bookkeeper', 'chef'] as const) {
      expect(canSeeRoute(role, '/dashboard/products')).toBe(false);
    }
  });

  it('integrations hub: owner, manager, bookkeeper (sections scoped inside); never receiver/chef', () => {
    expect(allowedRolesForPath('/dashboard/integrations')).toEqual(['owner', 'manager', 'bookkeeper']);
    expect(canSeeRoute('receiver', '/dashboard/integrations')).toBe(false);
    expect(canSeeRoute('chef', '/dashboard/integrations')).toBe(false);
  });

  it('bookkeeper can open the approvals queue (duplicate invoices are routed to them)', () => {
    expect(canSeeRoute('bookkeeper', '/dashboard/approvals')).toBe(true);
    expect(canSeeRoute('chef', '/dashboard/approvals')).toBe(false);
  });

  it('labels roles in both languages', () => {
    expect(labelForRole('receiver')).toBe('מקבל סחורה');
    expect(labelForRole('receiver', 'en')).toBe('Receiver');
    expect(labelForRole('unknown', 'en')).toBe('unknown');
  });
});
