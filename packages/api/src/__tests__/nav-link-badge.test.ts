import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, invoiceLines, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { linkBadge, MONEY_BADGES, NAV_BADGE_KEYS } from '../tasks/badges';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * W3-10 · the nav "לקשר" badge: spend not price-checked yet. Always neutral,
 * never blocking, ₪ named 'unchecked' (never atRisk / owed), ₪ only for owner /
 * manager / bookkeeper, from the queue's integer agorot.
 */
describe('linkBadge (pure)', () => {
  it('is neutral, never blocks, names its ₪ unchecked', () => {
    expect(linkBadge({ count: 7, unmappedAgorot: 124000 }, true)).toEqual({
      count: 7,
      ilsAgorot: 124000,
      block: false,
      tone: 'neutral',
      money: 'unchecked',
    });
  });
  it('hides the ₪ when the role may not see it, and is absent with no rows', () => {
    expect(linkBadge({ count: 3, unmappedAgorot: 500 }, false)?.ilsAgorot).toBeNull();
    expect(linkBadge({ count: 2, unmappedAgorot: 0 }, true)?.ilsAgorot).toBeNull();
    expect(linkBadge({ count: 0, unmappedAgorot: 0 }, true)).toBeNull();
  });
  it("'link' is a badge key but not a task-summed money badge", () => {
    expect(NAV_BADGE_KEYS).toContain('link');
    expect(MONEY_BADGES.has('link')).toBe(false);
  });
});

const db = createDb(testDbUrl());
let A: Tenant;
let B: Tenant;
const callerFor = (t: Tenant, role: Session['role'] = 'owner') =>
  appRouter.createCaller({ db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } } as AppContext);

async function unlinked(t: Tenant, total: string) {
  await db.insert(invoiceLines).values({
    invoiceId: t.invoiceId,
    productId: null,
    supplierSku: `L-${total}`,
    rawDescription: 'שורה לקישור',
    qtyBilled: '1',
    unit: 'kg',
    unitPriceBilled: total,
    lineTotal: total,
  });
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
  await unlinked(A, '12.40');
  await unlinked(B, '9999.99');
});
afterAll(() => resetDb(db));

describe('nav.badges → link', () => {
  it.each(['owner', 'manager', 'bookkeeper'] as const)('%s sees the neutral link badge with ₪ (own restaurant only)', async (role) => {
    const { badges } = await callerFor(A, role).nav.badges();
    expect(badges.link).toMatchObject({ tone: 'neutral', block: false, money: 'unchecked' });
    expect(badges.link!.ilsAgorot).toBeGreaterThanOrEqual(1240);
    expect(badges.link!.ilsAgorot).toBeLessThan(999999); // B's ₪ never reaches A
  });

  it.each(['chef', 'receiver'] as const)('%s gets no link badge (and so no ₪)', async (role) => {
    const { badges } = await callerFor(A, role).nav.badges();
    expect(badges.link ?? null).toBeNull();
  });
});
