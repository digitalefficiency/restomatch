import { describe, expect, expectTypeOf, it } from 'vitest';
import type { NavBadgeValue } from '../../components/notifications/model';
import { badgeLook, groupDot, withSingleSolid, type BadgeLook, type BadgeValueLike } from '../badgeLook';

const v = (over: Partial<BadgeValueLike> = {}): BadgeValueLike => ({
  count: 0,
  ilsAgorot: null,
  block: false,
  tone: 'neutral',
  ...over,
});
const staff = { fieldRole: false };
const field = { fieldRole: true };

describe('badgeLook · nothing to show (§6: never "0", never a spinner)', () => {
  it('no value (loading or a failed source) → no pill', () => {
    expect(badgeLook(undefined, staff)).toBeNull();
  });

  it('an empty count with no ₪ → no pill', () => {
    expect(badgeLook(v(), staff)).toBeNull();
    expect(badgeLook(v({ ilsAgorot: 0 }), staff)).toBeNull();
    expect(badgeLook(v({ count: -2 }), staff)).toBeNull();
    expect(badgeLook(v({ ilsAgorot: -500 }), staff)).toBeNull();
  });

  it('a broken figure reads as absent, never as a number', () => {
    expect(badgeLook(v({ count: Number.NaN }), staff)).toBeNull();
    expect(badgeLook(v({ count: Number.POSITIVE_INFINITY }), staff)).toBeNull();
    expect(badgeLook(v({ count: 2, ilsAgorot: Number.NaN }), staff)).toMatchObject({ pill: 'count', agorot: null, count: 2 });
    expect(badgeLook(v({ count: 2, ilsAgorot: Number.POSITIVE_INFINITY }), staff)).toMatchObject({ pill: 'count', agorot: null });
  });

  it('a ₪ pill never carries a negative or broken count into its accessible name', () => {
    expect(badgeLook(v({ count: -3, ilsAgorot: 29_600, block: true }), staff)).toMatchObject({ pill: 'solid', agorot: 29_600, count: 0 });
    expect(badgeLook(v({ count: Number.NaN, ilsAgorot: 15_300 }), staff)).toMatchObject({ pill: 'warn', count: 0 });
  });
});

describe('badgeLook · ₪ T2 pills (§5.1)', () => {
  it('blocked ₪ → the solid danger pill, danger rail dot, t2 danger', () => {
    expect(badgeLook(v({ count: 4, ilsAgorot: 29_600, block: true, tone: 'danger' }), staff)).toEqual<BadgeLook>({
      pill: 'solid',
      agorot: 29_600,
      count: 4,
      innerDot: false,
      railDot: 'danger',
      t2: 'danger',
    });
  });

  it('non-blocking ₪ → the warn pill, warn rail dot, t2 warn', () => {
    expect(badgeLook(v({ count: 2, ilsAgorot: 15_300, tone: 'warn' }), staff)).toEqual<BadgeLook>({
      pill: 'warn',
      agorot: 15_300,
      count: 2,
      innerDot: false,
      railDot: 'warn',
      t2: 'warn',
    });
  });

  it('₪ alone (count 0, e.g. claims owed) still shows the ₪ pill', () => {
    expect(badgeLook(v({ ilsAgorot: 45_100, money: 'owed' }), staff)).toMatchObject({ pill: 'warn', agorot: 45_100, count: 0 });
  });

  it("money 'atRisk' (approvals, pay run) is T2: solid when blocked, warn otherwise", () => {
    expect(badgeLook(v({ count: 4, ilsAgorot: 29_600, block: true, tone: 'danger', money: 'atRisk' }), staff)).toMatchObject({
      pill: 'solid',
      agorot: 29_600,
      t2: 'danger',
      railDot: 'danger',
    });
    expect(badgeLook(v({ count: 2, ilsAgorot: 15_300, money: 'atRisk' }), staff)).toMatchObject({ pill: 'warn', agorot: 15_300, t2: 'warn' });
  });
});

describe('badgeLook · field roles never see ₪ (§5.3 second guard)', () => {
  it('drops the ₪ and falls back to the count pill', () => {
    expect(badgeLook(v({ count: 3, ilsAgorot: 29_600, block: true, tone: 'danger' }), field)).toEqual<BadgeLook>({
      pill: 'count',
      agorot: null,
      count: 3,
      innerDot: true,
      railDot: 'danger',
      t2: null,
    });
  });

  it('a ₪-only badge shows nothing at all', () => {
    expect(badgeLook(v({ ilsAgorot: 45_100 }), field)).toBeNull();
  });

  it('no look a field role gets ever carries agorot or a T2 tone', () => {
    const inputs = [
      v({ count: 1, ilsAgorot: 100 }),
      v({ count: 1, ilsAgorot: 100, block: true, tone: 'danger' }),
      v({ count: 5, tone: 'warn' }),
    ];
    for (const input of inputs) {
      const look = badgeLook(input, field);
      expect(look?.agorot ?? null).toBeNull();
      expect(look?.t2 ?? null).toBeNull();
      expect(look?.pill).toBe('count');
    }
  });
});

describe('badgeLook · count pills', () => {
  it('neutral count → neutral rail dot, no inner dot, never bubbles', () => {
    expect(badgeLook(v({ count: 10 }), staff)).toEqual<BadgeLook>({
      pill: 'count',
      agorot: null,
      count: 10,
      innerDot: false,
      railDot: 'neutral',
      t2: null,
    });
  });

  it('a late delivery (tone warn) → warn rail dot', () => {
    expect(badgeLook(v({ count: 3, tone: 'warn' }), staff)).toMatchObject({ pill: 'count', railDot: 'warn', innerDot: false, t2: null });
  });

  it('a blocking item inside a count → the 6 px danger dot and a danger rail dot', () => {
    expect(badgeLook(v({ count: 10, block: true, tone: 'danger' }), staff)).toMatchObject({
      pill: 'count',
      innerDot: true,
      railDot: 'danger',
      t2: null,
    });
  });

  it('tone danger without a block stays neutral (danger only when a payment is blocked)', () => {
    expect(badgeLook(v({ count: 1, tone: 'danger' }), staff)).toMatchObject({ railDot: 'neutral', innerDot: false });
  });
});

describe('badgeLook · the server shape fits', () => {
  it('a NavBadgeValue (tRPC nav.badges) is a BadgeValueLike', () => {
    // Not `any`: if the router types stopped resolving, the match below would pass for anything.
    expectTypeOf<NavBadgeValue>().not.toBeAny();
    expectTypeOf<NavBadgeValue>().toMatchTypeOf<BadgeValueLike>();
    const server: NavBadgeValue = { count: 2, ilsAgorot: 45_100, block: false, tone: 'warn', money: 'owed' };
    expect(badgeLook(server, staff)).toMatchObject({ pill: 'warn', agorot: 45_100 });
  });
});

const solid = badgeLook(v({ count: 4, ilsAgorot: 29_600, block: true, tone: 'danger' }), staff)!;
const warn = badgeLook(v({ count: 2, ilsAgorot: 15_300, tone: 'warn' }), staff)!;
const count = badgeLook(v({ count: 3 }), staff)!;
const countBlocked = badgeLook(v({ count: 10, block: true, tone: 'danger' }), staff)!;

describe('withSingleSolid · at most one solid pill (§5.1)', () => {
  it('keeps the first solid in visual order and turns later ones into warn pills that still say "blocked"', () => {
    const out = withSingleSolid([
      ['approvals', solid],
      ['recovery', warn],
      ['payRun', solid],
    ]);
    expect(out.get('approvals')).toBe(solid);
    expect(out.get('recovery')).toBe(warn);
    expect(out.get('payRun')).toEqual({ ...solid, pill: 'warn' });
    expect(out.get('payRun')?.t2).toBe('danger');
    expect(out.get('payRun')?.railDot).toBe('danger');
    expect([...out.values()].filter((l) => l.pill === 'solid')).toHaveLength(1);
  });

  it('three blocked ₪ rows: only the first stays solid', () => {
    const out = withSingleSolid([
      ['approvals', solid],
      ['payRun', solid],
      ['recovery', solid],
    ]);
    expect([...out.values()].map((l) => l.pill)).toEqual(['solid', 'warn', 'warn']);
    expect([...out.values()].every((l) => l.t2 === 'danger' && l.railDot === 'danger')).toBe(true);
  });

  it('drops null looks and keeps the visual order', () => {
    const out = withSingleSolid([
      ['a', null],
      ['b', count],
      ['c', null],
      ['d', warn],
    ]);
    expect([...out.keys()]).toEqual(['b', 'd']);
  });

  it('does not mutate its input looks', () => {
    const second = { ...solid };
    withSingleSolid([
      ['a', solid],
      ['b', second],
    ]);
    expect(second.pill).toBe('solid');
  });

  it('a repeated key keeps its first look', () => {
    const out = withSingleSolid([
      ['approvals', solid],
      ['approvals', warn],
    ]);
    expect(out.size).toBe(1);
    expect(out.get('approvals')).toBe(solid);
  });

  it('no solid in, no solid out; empty in, empty out', () => {
    expect([...withSingleSolid([['a', warn], ['b', count]]).values()].map((l) => l.pill)).toEqual(['warn', 'count']);
    expect(withSingleSolid([]).size).toBe(0);
  });
});

describe('groupDot · only T2 ₪ bubbles (§5.1)', () => {
  it('any blocked ₪ → danger, even after a solid was demoted', () => {
    const looks = withSingleSolid([
      ['approvals', solid],
      ['payRun', solid],
    ]);
    expect(groupDot(['payRun'], looks)).toBe('danger');
    expect(groupDot(['recovery', 'approvals'], new Map([['recovery', warn], ['approvals', solid]]))).toBe('danger');
  });

  it("a manager's non-blocking ₪ still marks the group warn", () => {
    expect(groupDot(['approvals', 'inbox'], new Map([['approvals', warn], ['inbox', count]]))).toBe('warn');
  });

  it('counts never bubble, not even a count hiding a blocking item', () => {
    expect(groupDot(['receiving', 'queue'], new Map([['receiving', count], ['queue', countBlocked]]))).toBeNull();
  });

  it('keys without a look, and an empty group, give no dot', () => {
    expect(groupDot(['ledger', 'exports'], new Map([['approvals', solid]]))).toBeNull();
    expect(groupDot([], new Map())).toBeNull();
  });
});

describe('a ₪ amount that is not T2 shows its count only (forward-compatible money kinds)', () => {
  it('money "unchecked" (an open PR adds it) → a neutral count pill, no ₪, no group dot', () => {
    const look = badgeLook({ count: 7, ilsAgorot: 1_234_500, block: false, tone: 'neutral', money: 'unchecked' }, { fieldRole: false });
    expect(look).toMatchObject({ pill: 'count', agorot: null, count: 7, t2: null, railDot: 'neutral' });
    expect(groupDot(['k'], new Map([['k', look!]]))).toBeNull();
  });
  it('a non-blocking approvals ₪ with a neutral server tone is still a warn ₪ pill (the manager\'s ₪153)', () => {
    expect(badgeLook({ count: 2, ilsAgorot: 15_300, block: false, tone: 'neutral' }, { fieldRole: false })).toMatchObject({
      pill: 'warn',
      agorot: 15_300,
      t2: 'warn',
    });
  });
  it('"owed" (claims) is T2', () => {
    expect(badgeLook({ count: 10, ilsAgorot: 45_088, block: false, tone: 'warn', money: 'owed' }, { fieldRole: false })?.pill).toBe('warn');
  });
  it('a non-T2 amount with no count shows nothing (never a "0" count pill)', () => {
    expect(badgeLook({ count: 0, ilsAgorot: 1_234_500, block: false, tone: 'neutral', money: 'unchecked' }, { fieldRole: false })).toBeNull();
  });
  it('a non-T2 amount never turns solid: a block inside it is the danger dot on the count pill', () => {
    const look = badgeLook({ count: 3, ilsAgorot: 50_000, block: true, tone: 'danger', money: 'unchecked' }, { fieldRole: false });
    expect(look).toMatchObject({ pill: 'count', agorot: null, innerDot: true, railDot: 'danger', t2: null });
    expect(groupDot(['k'], new Map([['k', look!]]))).toBeNull();
  });
});
