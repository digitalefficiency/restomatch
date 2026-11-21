import { describe, expect, it } from 'vitest';
import { WHERE_IS_KIND_ROLES, WHERE_IS_KINDS, type WhereIsKind } from '@restomatch/api';
import { ALL_ROLES, canSeeRoute } from '@/lib/roles';

/**
 * nav.whereIs only searches a branch where the viewer's role may open the page
 * (warden note, 11.11). The server map must equal the route registry, or the
 * "פתחו שם" link would lead to a page the role can't open (or hide one it can).
 */
const PAGE: Record<WhereIsKind, string> = {
  invoice: '/dashboard/invoices',
  po: '/dashboard/orders',
  supplier: '/dashboard/suppliers',
  claim: '/dashboard/recovery',
  count: '/dashboard/inventory',
};

describe('whereIs KIND_ROLES = the route registry', () => {
  it.each(WHERE_IS_KINDS.map((k) => [k]))('%s', (kind) => {
    for (const role of ALL_ROLES) {
      expect([role, WHERE_IS_KIND_ROLES[kind].includes(role)]).toEqual([role, canSeeRoute(role, PAGE[kind])]);
    }
  });
});
