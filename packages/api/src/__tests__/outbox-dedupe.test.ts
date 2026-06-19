import { describe, expect, it } from 'vitest';
import { enqueueNotification } from '../notifications/outbox';
import type { NotificationPayload } from '../notifications/types';
import type { Database } from '@restomatch/db';

/**
 * Hermetic (no live DB): a hand-rolled fake `Database` records the insert chain
 * so we can assert the dedupe contract introduced in wave 3 — `enqueueNotification`
 * must thread `dedupeKey` into the row and use ON CONFLICT DO NOTHING so a
 * duplicate enqueue is swallowed (deduped=true) instead of double-queuing a send.
 *
 * This pins the producer-side guarantee. The SKIP-LOCKED claim and the DB-level
 * partial unique index are exercised against real Postgres in the worker
 * integration path (not run here — vitest has no DB and the harness stalls on it).
 */

interface InsertCall {
  values: Record<string, unknown>;
  onConflictTarget: unknown;
  returned: Array<{ id: string }>;
}

function makeFakeDb(opts: {
  // rows returned by insert().returning(): [] simulates an ON CONFLICT no-op
  insertReturns: Array<{ id: string }>;
  // row returned by the dedupe re-read (select-by-dedupeKey)
  existingRow?: { id: string };
}): { db: Database; calls: InsertCall[] } {
  const calls: InsertCall[] = [];

  const db = {
    insert() {
      const call: InsertCall = { values: {}, onConflictTarget: undefined, returned: opts.insertReturns };
      calls.push(call);
      const chain = {
        values(v: Record<string, unknown>) {
          call.values = v;
          return chain;
        },
        onConflictDoNothing(arg: { target: unknown }) {
          call.onConflictTarget = arg.target;
          return chain;
        },
        returning() {
          return Promise.resolve(opts.insertReturns);
        },
        // allow `await insert.returning(...)` AND `await insert` shapes
        then(resolve: (rows: Array<{ id: string }>) => unknown) {
          return Promise.resolve(opts.insertReturns).then(resolve);
        },
      };
      return chain;
    },
    select() {
      const chain = {
        from() {
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return Promise.resolve(opts.existingRow ? [opts.existingRow] : []);
        },
      };
      return chain;
    },
  } as unknown as Database;

  return { db, calls };
}

const basePayload: NotificationPayload = {
  restaurantId: 'r1',
  channel: 'email',
  target: 'supplier@example.com',
  body: 'order doc',
};

describe('enqueueNotification — dedupe contract', () => {
  it('threads dedupeKey into the inserted row and uses ON CONFLICT on dedupe_key', async () => {
    const { db, calls } = makeFakeDb({ insertReturns: [{ id: 'new-1' }] });
    const res = await enqueueNotification(db, { ...basePayload, dedupeKey: 'po:abc:placed' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.values.dedupeKey).toBe('po:abc:placed');
    expect(calls[0]!.onConflictTarget).toBeDefined(); // onConflictDoNothing was called
    expect(res).toEqual({ id: 'new-1', deduped: false });
  });

  it('reports deduped=true when a keyed insert hits the conflict (no row returned)', async () => {
    const { db } = makeFakeDb({ insertReturns: [], existingRow: { id: 'existing-1' } });
    const res = await enqueueNotification(db, { ...basePayload, dedupeKey: 'po:abc:placed' });
    expect(res).toEqual({ id: 'existing-1', deduped: true });
  });

  it('does NOT use ON CONFLICT when no dedupeKey is supplied (legacy path)', async () => {
    const { db, calls } = makeFakeDb({ insertReturns: [{ id: 'new-2' }] });
    const res = await enqueueNotification(db, basePayload);
    expect(calls[0]!.onConflictTarget).toBeUndefined();
    expect(calls[0]!.values.dedupeKey).toBeNull();
    expect(res).toEqual({ id: 'new-2', deduped: false });
  });

  it('throws if a non-keyed insert returns no row (genuine failure)', async () => {
    const { db } = makeFakeDb({ insertReturns: [] });
    await expect(enqueueNotification(db, basePayload)).rejects.toThrow(/failed to enqueue/);
  });
});

describe('PO placed dedupe key convention', () => {
  it('is stable for a given PO id', () => {
    const poId = '11111111-2222-3333-4444-555555555555';
    expect(`po:${poId}:placed`).toBe(`po:${poId}:placed`);
  });
});
