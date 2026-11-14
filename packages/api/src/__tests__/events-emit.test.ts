import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityEvents,
  and,
  applyAuditImmutableRls,
  applyCoreTenantRls,
  auditLog,
  createDb,
  discrepancies,
  ensureRlsAppRole,
  eq,
  sql,
  testDbUrl,
  withRestaurant,
  type Database,
} from '@restomatch/db';
import { logActivity, logDomainEvent, type ActivityEventType } from '../activity';
import { DOMAIN_EVENT_TYPES, emit, EVENT_EFFECTS, registerEffectHandler, TRANSITION_EVENT_TYPES } from '../events';
import { discrepancyMachine, hasEnumValue, invoiceMachine, recoveryMachine, transition } from '../lifecycle';
import { resetDb, seedPlans, seedTenant, type Tenant } from './fixtures';

/**
 * G-05 emit(): each effect runs in its own savepoint — a throwing effect is
 * logged and rolled back alone, the decision commits; an unregistered kind is
 * a skip. Activity keeps its 6 legacy kinds exactly; kind `event` waits for G-03.
 */

const TEST_DB_URL = testDbUrl();
const ownerDb = createDb(TEST_DB_URL);
/** Collection-time probe: G-03 adds activity_event_type 'event'. */
const hasEventKind = await hasEnumValue(ownerDb, 'activity_event_type', 'event');
let appDb: Database;
let A: Tenant;
const offs: Array<() => void> = [];

function asTenant<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return withRestaurant(appDb, A.restaurantId, async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${A.ownerUserId}, true)`);
    return fn(tx);
  });
}
const accept = () =>
  asTenant((tx) =>
    transition(tx, discrepancyMachine, {
      id: A.discrepancyId,
      restaurantId: A.restaurantId,
      event: 'accept',
      expectedFrom: 'open',
      actorId: A.ownerUserId,
    }),
  );

beforeAll(async () => {
  await applyCoreTenantRls(TEST_DB_URL);
  await applyAuditImmutableRls(TEST_DB_URL);
  appDb = createDb(await ensureRlsAppRole(TEST_DB_URL));
});
beforeEach(async () => {
  await resetDb(ownerDb);
  await seedPlans(ownerDb);
  A = await seedTenant(ownerDb, 'EA');
});
afterEach(() => {
  while (offs.length) offs.pop()!();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await resetDb(ownerDb);
});

describe('EVENT_EFFECTS', () => {
  it('declares effects for every domain event, and every machine edge emits a declared transition event', () => {
    for (const t of DOMAIN_EVENT_TYPES) expect(EVENT_EFFECTS[t], t).toBeDefined();
    const emitted = new Set(
      [invoiceMachine, discrepancyMachine, recoveryMachine].flatMap((m) =>
        (m.events as readonly string[]).map((e) => (m.edges as Record<string, { domainEvent: string }>)[e]!.domainEvent),
      ),
    );
    expect([...emitted].sort()).toEqual([...TRANSITION_EVENT_TYPES].sort());
    expect(EVENT_EFFECTS['discrepancy.accepted']).toContain('claim');
  });
});

describe('emit()', () => {
  it('a throwing effect → the decision commits, the effect is logged and its own inserts roll back', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    offs.push(
      registerEffectHandler('claim', async (db) => {
        await db.insert(activityEvents).values({
          restaurantId: A.restaurantId,
          eventType: 'invoice_matched',
          title: 'half-done effect',
          entityId: A.discrepancyId,
        });
        throw new Error('claim effect exploded');
      }),
    );
    const r = await accept();
    expect(r.effects?.failed).toEqual(['claim']);
    const [d] = await ownerDb.select().from(discrepancies).where(eq(discrepancies.id, A.discrepancyId));
    expect(d!.resolutionStatus).toBe('accepted');
    const audits = await ownerDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, A.discrepancyId), eq(auditLog.action, 'discrepancy.approved')));
    expect(audits).toHaveLength(1);
    expect(await ownerDb.select().from(activityEvents).where(eq(activityEvents.title, 'half-done effect'))).toHaveLength(0);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("'claim' effect failed"))).toBe(true);
  });

  it('an unregistered kind is a logged skip, never a throw', async () => {
    const r = await accept();
    expect(r.effects?.skipped).toContain('claim');
    expect(r.effects?.failed).toEqual([]);
  });

  it('a hand-off event (not a transition) runs its registered effects', async () => {
    const seen: string[] = [];
    offs.push(registerEffectHandler('task', async (_db, e) => void seen.push(e.type)));
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const r = await asTenant((tx) =>
      emit(tx, {
        type: 'receipt.closed_with_exceptions',
        restaurantId: A.restaurantId,
        actorId: A.ownerUserId,
        at: new Date(),
        entityType: 'goods_receipt',
        entityId: A.grId,
        payload: { poId: A.poId, exceptionLines: 2 },
      }),
    );
    expect(seen).toEqual(['receipt.closed_with_exceptions']);
    expect(r.ran).toContain('task');
  });
});

describe('activity', () => {
  it('the 6 legacy kinds keep their exact rows', async () => {
    const kinds: ActivityEventType[] = [
      'invoice_received',
      'invoice_matched',
      'discrepancy_approved',
      'discrepancy_rejected',
      'alias_learned',
      'sync_completed',
    ];
    for (const k of kinds) {
      await logActivity(ownerDb, {
        restaurantId: A.restaurantId,
        eventType: k,
        title: `t-${k}`,
        detail: 'd',
        entityType: 'invoice',
        entityId: A.invoiceId,
        actorId: A.ownerUserId,
        metadata: { n: 1 },
      });
    }
    const rows = (await ownerDb.select().from(activityEvents).where(eq(activityEvents.restaurantId, A.restaurantId))).filter((r) =>
      r.title.startsWith('t-'),
    );
    expect(
      rows
        .map((r) => ({ eventType: r.eventType, title: r.title, detail: r.detail, entityType: r.entityType, entityId: r.entityId, actorId: r.actorId, metadata: r.metadata }))
        .sort((a, b) => a.eventType.localeCompare(b.eventType)),
    ).toEqual(
      [...kinds].sort().map((k) => ({
        eventType: k,
        title: `t-${k}`,
        detail: 'd',
        entityType: 'invoice',
        entityId: A.invoiceId,
        actorId: A.ownerUserId,
        metadata: { n: 1 },
      })),
    );
  });

  it('logActivity still swallows a failed insert', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      logActivity(ownerDb, { restaurantId: '00000000-0000-0000-0000-000000000000', eventType: 'invoice_received', title: 'x' }),
    ).resolves.toBeUndefined();
  });

  it.skipIf(hasEventKind)("interim: without G-03's 'event' kind, a domain event writes no row and never throws", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const count = async () => (await ownerDb.select().from(activityEvents).where(eq(activityEvents.restaurantId, A.restaurantId))).length;
    const before = await count();
    const r = await asTenant((tx) =>
      logDomainEvent(tx, { restaurantId: A.restaurantId, kind: 'discrepancy.escalated', title: 'x', entityId: A.discrepancyId }),
    );
    expect(r).toBe('skipped');
    expect(await count()).toBe(before);
  });

  it.skipIf(!hasEventKind)("G-03: kind 'event' with metadata.kind (skipped until G-03 is migrated here)", async () => {
    await accept();
    const rows = await ownerDb.select().from(activityEvents).where(eq(activityEvents.entityId, A.discrepancyId));
    expect(rows.map((r) => [r.eventType, (r.metadata as { kind?: string }).kind])).toContainEqual(['event', 'discrepancy.accepted']);
  });
});
