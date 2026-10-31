import { describe, expect, it } from 'vitest';
import { ALL_ROLES, allowedRolesForPath } from '@/lib/roles';
import { FORBIDDEN_PATH, forbiddenFrom, forbiddenRewrite, screenKeyForPath } from '../access';
import { FORBIDDEN_PAIRS } from './forbiddenPairs';

describe('forbiddenRewrite (middleware role gate → in-shell 403, ia-nav-07)', () => {
  it('rewrites all 25 probed role/route pairs to the forbidden page, keeping the original URL in `from`', () => {
    expect(FORBIDDEN_PAIRS).toHaveLength(25);
    for (const [role, path] of FORBIDDEN_PAIRS) {
      const to = forbiddenRewrite(path, '?sev=block', role);
      expect(to, `${role} → ${path}`).not.toBeNull();
      const url = new URL(to!, 'https://app.test');
      expect(url.pathname).toBe(FORBIDDEN_PATH);
      expect(url.searchParams.get('from')).toBe(`${path}?sev=block`);
    }
  });

  it('never rewrites a route the role may open', () => {
    for (const role of ALL_ROLES) {
      for (const path of ['/dashboard', '/dashboard/settings', '/dashboard/forbidden', '/dashboard/go']) {
        expect(forbiddenRewrite(path, '', role), `${role} ${path}`).toBeNull();
      }
    }
    expect(forbiddenRewrite('/dashboard/orders', '', 'owner')).toBeNull();
    expect(forbiddenRewrite('/dashboard/receiving/abc', '', 'receiver')).toBeNull();
    // TODO(W1-03/W2): the receiver loses the ledger (owner decision 25.10) — not pinned here.
  });

  it('agrees with allowedRolesForPath for every role (no drift from the role table)', () => {
    for (const role of ALL_ROLES) {
      for (const [, path] of FORBIDDEN_PAIRS) {
        const allowed = allowedRolesForPath(path);
        expect(forbiddenRewrite(path, '', role) === null, `${role} ${path}`).toBe(!allowed || allowed.includes(role));
      }
    }
  });

  it('ignores anything outside /dashboard', () => {
    expect(forbiddenRewrite('/admin', '', 'chef')).toBeNull();
    expect(forbiddenRewrite('/login', '', 'chef')).toBeNull();
  });
});

describe('forbiddenFrom', () => {
  it('accepts only same-origin /dashboard paths', () => {
    expect(forbiddenFrom('/dashboard/orders?x=1')).toBe('/dashboard/orders?x=1');
    expect(forbiddenFrom('/dashboard')).toBe('/dashboard');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '/login', '/dashboardx', '', null, 42]) {
      expect(forbiddenFrom(bad), String(bad)).toBeNull();
    }
  });
});

describe('screenKeyForPath', () => {
  it('names the screen by longest prefix', () => {
    expect(screenKeyForPath('/dashboard/approvals/pay-run')).toBe('payRun');
    expect(screenKeyForPath('/dashboard/approvals')).toBe('approvals');
    expect(screenKeyForPath('/dashboard/leaks/claims')).toBe('claims');
    expect(screenKeyForPath('/dashboard/leaks/breakdown')).toBe('leaks');
    expect(screenKeyForPath('/dashboard/products/123')).toBe('catalog');
    expect(screenKeyForPath('/dashboard/suppliers/ledger')).toBe('ledger');
    expect(screenKeyForPath('/dashboard/nope')).toBe('home');
  });
});
