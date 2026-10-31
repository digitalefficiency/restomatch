import { describe, expect, it } from 'vitest';
import { branchSafeTarget, detailParent } from '../branchSafeTarget';

describe('branchSafeTarget (ia-nav-08, exec-desktop-23)', () => {
  it('keeps the path and the non-entity filters: approvals?sev=block survives a switch', () => {
    expect(branchSafeTarget('/dashboard/approvals', '?sev=block', 'owner')).toEqual({
      href: '/dashboard/approvals?sev=block',
      reason: 'kept',
      fromPath: '/dashboard/approvals',
    });
  });

  it('keeps p, from, to, cmp, sev, type, st — and drops entity filters and selections', () => {
    const t = branchSafeTarget(
      '/dashboard/leaks',
      '?p=custom&from=2026-10-01&to=2026-10-25&cmp=prev&sev=warn&type=price&st=open&sup=abc&cat=x&sel=inv1&g=product',
      'owner',
    );
    expect(t.reason).toBe('kept');
    const url = new URL(t.href, 'https://app.test');
    expect(url.pathname).toBe('/dashboard/leaks');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      p: 'custom',
      from: '2026-10-01',
      to: '2026-10-25',
      cmp: 'prev',
      sev: 'warn',
      type: 'price',
      st: 'open',
    });
  });

  it('a detail route falls back to its parent list (the id belongs to the old branch)', () => {
    const cases: Array<[string, string]> = [
      ['/dashboard/orders/0b5e', '/dashboard/orders'],
      ['/dashboard/receiving/0b5e', '/dashboard/receiving'],
      ['/dashboard/suppliers/0b5e', '/dashboard/suppliers'],
      ['/dashboard/suppliers/0b5e/leak-card', '/dashboard/suppliers'],
      ['/dashboard/products/0b5e', '/dashboard/catalog'],
      ['/dashboard/recipes/0b5e', '/dashboard/recipes'],
      ['/dashboard/inventory/0b5e', '/dashboard/inventory'],
      ['/dashboard/invoices/0b5e', '/dashboard/approvals'],
    ];
    for (const [from, parent] of cases) {
      expect(branchSafeTarget(from, '?sev=block', 'owner'), from).toEqual({ href: parent, reason: 'parent', fromPath: from });
    }
  });

  it('static children of a detail base are not details', () => {
    for (const p of ['/dashboard/orders/new', '/dashboard/orders/capture', '/dashboard/suppliers/ledger', '/dashboard/recipes/new', '/dashboard/inventory/count']) {
      expect(detailParent(p), p).toBeNull();
      expect(branchSafeTarget(p, '', 'owner').reason, p).toBe('kept');
    }
  });

  it('a screen the target role cannot open lands on home, with the reason', () => {
    expect(branchSafeTarget('/dashboard/approvals', '?sev=block', 'chef')).toEqual({
      href: '/dashboard',
      reason: 'home',
      fromPath: '/dashboard/approvals',
    });
    // The receiver can open invoices but not their parent (approvals) → home.
    expect(branchSafeTarget('/dashboard/invoices/0b5e', '', 'receiver').reason).toBe('home');
    expect(branchSafeTarget('/dashboard/chain', '', 'manager').reason).toBe('home');
  });

  it('home stays home; trailing slashes are normalised', () => {
    expect(branchSafeTarget('/dashboard', '?p=ytd', 'chef')).toEqual({ href: '/dashboard?p=ytd', reason: 'kept', fromPath: '/dashboard' });
    expect(branchSafeTarget('/dashboard/orders/', '', 'owner').href).toBe('/dashboard/orders');
  });
});
