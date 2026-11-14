import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsRoleConfirm } from '../role-change';

describe('needsRoleConfirm (W2-14 guarded role transitions)', () => {
  it('promoting anyone to owner needs the confirm step', () => {
    for (const from of ['manager', 'bookkeeper', 'receiver', 'chef'] as const) {
      expect(needsRoleConfirm(from, 'owner')).toBe(true);
    }
  });
  it('downgrading an owner, manager or bookkeeper needs the confirm step', () => {
    expect(needsRoleConfirm('owner', 'manager')).toBe(true);
    expect(needsRoleConfirm('manager', 'receiver')).toBe(true);
    expect(needsRoleConfirm('manager', 'bookkeeper')).toBe(true);
    expect(needsRoleConfirm('bookkeeper', 'chef')).toBe(true);
  });
  it('moves between receiver and chef, or upward below owner, save directly', () => {
    expect(needsRoleConfirm('receiver', 'chef')).toBe(false);
    expect(needsRoleConfirm('chef', 'manager')).toBe(false);
    expect(needsRoleConfirm('bookkeeper', 'manager')).toBe(false);
    expect(needsRoleConfirm('manager', 'manager')).toBe(false);
  });
  it('the team route no longer uses window.confirm', () => {
    const src = readFileSync(join(__dirname, '..', 'team-client.tsx'), 'utf8');
    expect(src).not.toMatch(/window\.confirm/);
  });
});
