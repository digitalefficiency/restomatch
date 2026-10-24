import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createDb, eq, invoices, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { isInvoiceNumberTaken, readDuplicateOf, withoutDuplicateOf } from '../lib/invoiceDedupe';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Duplicate invoice numbers (invoices_dedupe_idx, UNIQUE (supplier_id,
 * invoice_number)): the receiving review flags a possible duplicate read, and
 * correcting the number to one already on file is a translated CONFLICT that
 * names the holder — never a raw 500.
 */
const db = createDb(testDbUrl());

function callerFor(t: Tenant, role: 'owner' | 'manager' | 'receiver' = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

let A: Tenant;
let B: Tenant;

/** A second invoice from A's supplier, as the worker leaves a duplicate read. */
async function duplicateRead(t: Tenant, marker = true) {
  const [inv] = await db
    .insert(invoices)
    .values({
      restaurantId: t.restaurantId,
      supplierId: t.supplierId,
      invoiceNumber: null,
      status: 'parsed',
      source: 'photo',
      createdBy: t.ownerUserId,
      ocrPayload: {
        provider: 'claude_vision',
        raw: marker
          ? { duplicateOf: { invoiceId: t.invoiceId, invoiceNumber: t.invoiceNumber }, other: 1 }
          : { other: 1 },
      },
    })
    .returning();
  return inv!;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

afterAll(async () => {
  await resetDb(db);
});

describe('receiving.getInvoice — duplicateOf', () => {
  it('returns only the duplicated number (no other invoice id, no payload)', async () => {
    const dup = await duplicateRead(A);
    const r = await callerFor(A, 'receiver').receiving.getInvoice({ invoiceId: dup.id });
    expect(r.duplicateOf).toEqual({ invoiceNumber: A.invoiceNumber });
    expect(JSON.stringify(r)).not.toContain(A.invoiceId);
    expect(r).not.toHaveProperty('ocrPayload');
  });

  it('is null for an ordinary invoice', async () => {
    const r = await callerFor(A).receiving.getInvoice({ invoiceId: A.invoiceId });
    expect(r.duplicateOf).toBeNull();
  });

  it('is tenant scoped: another restaurant cannot read the marker', async () => {
    const dup = await duplicateRead(A);
    await expect(callerFor(B).receiving.getInvoice({ invoiceId: dup.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('receiving.updateInvoiceHeader — invoice number already on file', () => {
  it('a taken number is a CONFLICT with appCode + the holder, and nothing is written', async () => {
    const dup = await duplicateRead(A);
    const err = await callerFor(A, 'manager')
      .receiving.updateInvoiceHeader({ invoiceId: dup.id, patch: { invoiceNumber: A.invoiceNumber, totalInclVat: 99 } })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    const e = err as TRPCError & { cause: { appCode: string; appParams: Record<string, string> } };
    expect(e.code).toBe('CONFLICT');
    expect(e.cause.appCode).toBe('invoice.numberTaken');
    expect(e.cause.appParams.invoiceNumber).toBe(A.invoiceNumber);
    expect(e.cause.appParams.holderInvoiceId).toBe(A.invoiceId);
    expect(e.cause.appParams.holderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.message).toContain(A.invoiceNumber);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, dup.id));
    expect(row?.invoiceNumber).toBeNull();
    expect(row?.totalInclVat).toBeNull(); // the whole update rolled back
    expect(readDuplicateOf(row?.ocrPayload)).not.toBeNull();
  });

  it('a different free number saves and clears the duplicate marker (other payload kept)', async () => {
    const dup = await duplicateRead(A);
    await callerFor(A, 'manager').receiving.updateInvoiceHeader({ invoiceId: dup.id, patch: { invoiceNumber: '  77-NEW ' } });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, dup.id));
    expect(row?.invoiceNumber).toBe('77-NEW');
    expect(readDuplicateOf(row?.ocrPayload)).toBeNull();
    expect((row?.ocrPayload as { raw: { other: number } }).raw.other).toBe(1);
    const r = await callerFor(A).receiving.getInvoice({ invoiceId: dup.id });
    expect(r.duplicateOf).toBeNull();
  });

  it('saving null (the correction form does on every save) keeps the marker', async () => {
    const dup = await duplicateRead(A);
    await callerFor(A, 'manager').receiving.updateInvoiceHeader({
      invoiceId: dup.id,
      patch: { invoiceNumber: null, totalInclVat: 50 },
    });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, dup.id));
    expect(row?.totalInclVat).toBe('50.00');
    expect(readDuplicateOf(row?.ocrPayload)).toEqual({ invoiceId: A.invoiceId, invoiceNumber: A.invoiceNumber });
  });

  it('the same number at another supplier/tenant is not a conflict', async () => {
    await callerFor(B, 'manager').receiving.updateInvoiceHeader({
      invoiceId: B.invoiceId,
      patch: { invoiceNumber: A.invoiceNumber },
    });
    const [row] = await db.select().from(invoices).where(eq(invoices.id, B.invoiceId));
    expect(row?.invoiceNumber).toBe(A.invoiceNumber);
  });

  it('a receiver cannot correct the header', async () => {
    const dup = await duplicateRead(A);
    await expect(
      callerFor(A, 'receiver').receiving.updateInvoiceHeader({ invoiceId: dup.id, patch: { invoiceNumber: 'X' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('isInvoiceNumberTaken', () => {
  it('matches 23505 on invoices_dedupe_idx anywhere in the cause chain, nothing else', () => {
    const pg = { code: '23505', constraint_name: 'invoices_dedupe_idx' };
    expect(isInvoiceNumberTaken(pg)).toBe(true);
    expect(isInvoiceNumberTaken(new Error('wrapped', { cause: new Error('again', { cause: pg }) }))).toBe(true);
    expect(isInvoiceNumberTaken({ code: '23505', constraint_name: 'other_unique_idx' })).toBe(false);
    expect(isInvoiceNumberTaken({ code: '23503', constraint_name: 'invoices_dedupe_idx' })).toBe(false);
    expect(isInvoiceNumberTaken(new Error('x'))).toBe(false);
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isInvoiceNumberTaken(loop)).toBe(false);
  });

  it('withoutDuplicateOf leaves a payload without the marker untouched', () => {
    const p = { provider: 'x', raw: { a: 1 } };
    expect(withoutDuplicateOf(p)).toBe(p);
    expect(withoutDuplicateOf(null)).toBeNull();
  });
});
