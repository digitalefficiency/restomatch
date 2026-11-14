import { describe, expect, it } from 'vitest';
import type { UserRole } from '@restomatch/db';
import { FOOTER_GROUPS, GROUP_ORDER, defaultOpenGroups, planFolds, type FoldInput } from '../groups';
import type { GroupKey } from '../types';

const ROLES: readonly UserRole[] = ['owner', 'manager', 'bookkeeper', 'chef', 'receiver'];

/** A panel with nothing open and no overflow; each case sets what it tests. */
function panel(over: Partial<FoldInput>): FoldInput {
  return { overflow: 0, open: [], openedAt: {}, holdsT2: [], savings: {}, ...over };
}

describe('GROUP_ORDER / FOOTER_GROUPS', () => {
  it('keeps the job order and the footer group', () => {
    expect(GROUP_ORDER).toEqual(['top', 'money', 'leaks', 'procure', 'kitchen', 'chain', 'admin']);
    expect(FOOTER_GROUPS).toEqual(['admin']);
  });
});

describe('defaultOpenGroups (spec §4.2)', () => {
  it.each<[UserRole, GroupKey[]]>([
    ['owner', ['money', 'leaks']],
    ['manager', ['money', 'procure']],
    ['bookkeeper', ['money', 'leaks']],
    ['chef', []],
    ['receiver', []],
  ])('%s opens %j', (role, expected) => {
    expect(defaultOpenGroups(role)).toEqual(expected);
  });

  it('uses the owner row without a role', () => {
    expect(defaultOpenGroups()).toEqual(['money', 'leaks']);
    expect(defaultOpenGroups(undefined)).toEqual(defaultOpenGroups('owner'));
  });

  it('uses the owner row for a role it does not know at runtime, object member names included', () => {
    for (const role of ['platform', 'admin', 'Owner', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(defaultOpenGroups(role as UserRole)).toEqual(['money', 'leaks']);
    }
  });

  it('never opens the footer group or the flat top group, and names only real groups', () => {
    for (const role of [...ROLES, undefined]) {
      for (const g of defaultOpenGroups(role)) {
        expect(GROUP_ORDER).toContain(g);
        expect(FOOTER_GROUPS).not.toContain(g);
        expect(g).not.toBe('top');
      }
    }
  });

  it('returns a fresh array, so a caller that mutates it cannot change the defaults', () => {
    const first = defaultOpenGroups('manager');
    first.push('chain');
    expect(defaultOpenGroups('manager')).toEqual(['money', 'procure']);
  });
});

describe('planFolds (spec §4.2 fit rule)', () => {
  const MAIN: readonly GroupKey[] = ['money', 'leaks', 'procure', 'kitchen', 'chain'];
  const roomy = { money: 500, leaks: 500, procure: 500, kitchen: 500, chain: 500 };

  it('folds nothing at 1 px of overflow or less (sub-pixel rounding), or when overflow is not a number', () => {
    for (const overflow of [-20, 0, 0.5, 1, Number.NaN]) {
      expect(planFolds(panel({ overflow, open: MAIN, savings: roomy }))).toEqual([]);
    }
  });

  it('folds as soon as the overflow passes the 1 px tolerance', () => {
    expect(planFolds(panel({ overflow: 1.5, open: ['money', 'kitchen'], savings: roomy }))).toEqual(['kitchen']);
  });

  it('never folds the group just opened, the current page group, a T2 ₪ group or top, even when that is not enough', () => {
    const folds = planFolds(
      panel({
        overflow: 10_000,
        open: ['top', 'money', 'leaks', 'procure', 'kitchen', 'admin'],
        justOpened: 'kitchen',
        here: 'procure',
        holdsT2: ['money'],
        savings: { top: 50, money: 50, leaks: 50, procure: 50, kitchen: 50, admin: 50 },
      }),
    );
    expect(folds).toEqual(['admin', 'leaks']);
  });

  it('reads a null justOpened or here as "none", not as a reason to keep every group', () => {
    const folds = planFolds(panel({ overflow: 10_000, open: ['money', 'leaks', 'procure'], justOpened: null, here: null }));
    expect(folds).toEqual(['procure', 'leaks', 'money']);
  });

  it('keeps כסף open while it carries ₪, even if the panel still overflows', () => {
    const folds = planFolds(panel({ overflow: 500, open: ['money', 'leaks'], holdsT2: ['money'], savings: { money: 400, leaks: 100 } }));
    expect(folds).toEqual(['leaks']);
  });

  it('folds the least recently opened group first', () => {
    const folds = planFolds(
      panel({
        overflow: 10_000,
        open: ['money', 'leaks', 'procure', 'kitchen'],
        openedAt: { money: 4, leaks: 1, procure: 3, kitchen: 2 },
        savings: roomy,
      }),
    );
    expect(folds).toEqual(['leaks', 'kitchen', 'procure', 'money']);
  });

  it('treats a group with no open record as the oldest', () => {
    // On a tie kitchen would fold first; money has no record, so it is older.
    expect(planFolds(panel({ overflow: 10_000, open: ['money', 'kitchen'], openedAt: { kitchen: 1 } }))).toEqual(['money', 'kitchen']);
  });

  it('treats a non-finite open record as missing', () => {
    expect(planFolds(panel({ overflow: 10_000, open: ['money', 'leaks'], openedAt: { money: Number.NaN, leaks: 2 } }))).toEqual([
      'money',
      'leaks',
    ]);
  });

  it('breaks ties by folding the group later in GROUP_ORDER first', () => {
    const open: GroupKey[] = ['money', 'leaks', 'procure', 'kitchen', 'chain', 'admin'];
    expect(planFolds(panel({ overflow: 10_000, open }))).toEqual(['admin', 'chain', 'kitchen', 'procure', 'leaks', 'money']);
    expect(planFolds(panel({ overflow: 10_000, open: ['leaks', 'chain'], openedAt: { leaks: 3, chain: 3 } }))).toEqual(['chain', 'leaks']);
  });

  it('folds the footer admin group when it is needed, and only then', () => {
    expect(planFolds(panel({ overflow: 40, open: ['money', 'admin'], holdsT2: ['money'], savings: { admin: 96 } }))).toEqual(['admin']);
    const recentAdmin = { open: ['leaks', 'admin'] as GroupKey[], openedAt: { leaks: 1, admin: 5 }, savings: { leaks: 100, admin: 96 } };
    expect(planFolds(panel({ ...recentAdmin, overflow: 90 }))).toEqual(['leaks']);
    expect(planFolds(panel({ ...recentAdmin, overflow: 150 }))).toEqual(['leaks', 'admin']);
  });

  it('stops as soon as the savings cover the overflow, less the 1 px tolerance', () => {
    const base = {
      open: ['money', 'leaks', 'procure'] as GroupKey[],
      openedAt: { procure: 1, leaks: 2, money: 3 },
      savings: { procure: 60, leaks: 50, money: 200 },
    };
    expect(planFolds(panel({ ...base, overflow: 61 }))).toEqual(['procure']); // 60 ≥ 60
    expect(planFolds(panel({ ...base, overflow: 62 }))).toEqual(['procure', 'leaks']); // 60 < 61
    expect(planFolds(panel({ ...base, overflow: 111 }))).toEqual(['procure', 'leaks']); // 110 ≥ 110: money stays open
    expect(planFolds(panel({ ...base, overflow: 112 }))).toEqual(['procure', 'leaks', 'money']);
  });

  it('folds every candidate, in fold order, when even all of them are not enough', () => {
    const folds = planFolds(panel({ overflow: 5_000, open: ['money', 'leaks', 'procure'], here: 'leaks', savings: { money: 100, procure: 100 } }));
    expect(folds).toEqual(['procure', 'money']);
  });

  it('counts missing, non-finite and negative savings as 0', () => {
    // kitchen 50 → procure +0 → leaks 100 ≥ 99: a negative saving must not cost money its place.
    const folds = planFolds(
      panel({ overflow: 100, open: ['money', 'leaks', 'procure', 'kitchen'], savings: { kitchen: 50, procure: -1000, leaks: 50, money: 50 } }),
    );
    expect(folds).toEqual(['kitchen', 'procure', 'leaks']);
    const unknown = panel({ overflow: 100, open: ['leaks', 'procure'], savings: { procure: Number.NaN, leaks: Number.POSITIVE_INFINITY } });
    expect(planFolds(unknown)).toEqual(['procure', 'leaks']);
  });

  it('folds a group listed twice only once, and leaves its input untouched', () => {
    const input = Object.freeze(
      panel({
        overflow: 10_000,
        open: Object.freeze(['leaks', 'procure', 'leaks'] as GroupKey[]),
        openedAt: Object.freeze({}),
        holdsT2: Object.freeze([] as GroupKey[]),
        savings: Object.freeze({}),
      }),
    );
    expect(planFolds(input)).toEqual(['procure', 'leaks']);
    expect(input.open).toEqual(['leaks', 'procure', 'leaks']);
  });
});
