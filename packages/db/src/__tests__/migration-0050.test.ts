import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
  invoices,
  restaurants,
  suppliers,
} from '../index';
import { testDbUrl } from '../test-env';

/**
 * Migration-shape test for 0050_ingest + 0051_invoice_source_whatsapp:
 * the four ingest tables, their replay / token uniques, the CHECK domains,
 * the SECURITY DEFINER resolver and the new invoice_source value.
 */
const url = testDbUrl();
const sql = postgres(url, { max: 1, prepare: false });
const db = createDb(url);

let restaurantId: string;

beforeAll(async () => {
  const [r] = await db.insert(restaurants).values({ name: '0050 shape', businessId: '000000050' }).returning();
  restaurantId = r!.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, restaurantId));
  await sql.end();
});

describe('0050 / 0051 migration shape', () => {
  it('creates the four restaurant_id tables', async () => {
    const rows = (await sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'restaurant_id'
        and table_name in ('ingest_channels','ingest_senders','ingest_messages','ingest_documents')
      order by table_name
    `) as unknown as Array<{ table_name: string }>;
    expect(rows.map((r) => r.table_name)).toEqual([
      'ingest_channels',
      'ingest_documents',
      'ingest_messages',
      'ingest_senders',
    ]);
  });

  it('0050 itself enables per-restaurant RLS on all four tables (no rls/*.sql edit)', async () => {
    const rows = (await sql`
      select c.relname, c.relrowsecurity, p.polname
      from pg_class c left join pg_policy p on p.polrelid = c.oid
      where c.relname in ('ingest_channels','ingest_senders','ingest_messages','ingest_documents')
      order by c.relname
    `) as unknown as Array<{ relname: string; relrowsecurity: boolean; polname: string | null }>;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true);
      expect(r.polname).toBe(`${r.relname}_tenant`);
    }
  });

  it('token hashes are unique and only one channel per kind is active', async () => {
    const [c] = await db
      .insert(ingestChannels)
      .values({ restaurantId, kind: 'email', tokenHash: 'a'.repeat(64), tokenHint: 'aaaa' })
      .returning();
    await expect(
      db.insert(ingestChannels).values({ restaurantId, kind: 'whatsapp', tokenHash: 'a'.repeat(64), tokenHint: 'aaaa' }),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.insert(ingestChannels).values({ restaurantId, kind: 'email', tokenHash: 'b'.repeat(64), tokenHint: 'bbbb' }),
    ).rejects.toMatchObject({ code: '23505' });
    await db.update(ingestChannels).set({ active: false }).where(eq(ingestChannels.id, c!.id));
    await db.insert(ingestChannels).values({ restaurantId, kind: 'email', tokenHash: 'b'.repeat(64), tokenHint: 'bbbb' });
  });

  it('the definer resolver finds only an ACTIVE token', async () => {
    const live = (await sql`select * from app.ingest_resolve_channel(${'b'.repeat(64)})`) as unknown as Array<{
      restaurant_id: string;
      kind: string;
    }>;
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ restaurant_id: restaurantId, kind: 'email' });
    const revoked = await sql`select * from app.ingest_resolve_channel(${'a'.repeat(64)})`;
    expect(revoked).toHaveLength(0);
    const rows = (await sql`
      select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'ingest_resolve_channel'
    `) as unknown as Array<{ prosecdef: boolean }>;
    expect(rows).toEqual([{ prosecdef: true }]);
  });

  it('a replayed provider message id is rejected per restaurant + kind', async () => {
    const [channel] = await db
      .select()
      .from(ingestChannels)
      .where(eq(ingestChannels.tokenHash, 'b'.repeat(64)));
    const row = {
      restaurantId,
      channelId: channel!.id,
      kind: 'email' as const,
      provider: 'stub',
      providerMessageId: 'em_1',
      sender: 'a@b.co',
      senderAllowed: false,
      status: 'needs_review' as const,
    };
    const [m] = await db.insert(ingestMessages).values(row).returning();
    await expect(db.insert(ingestMessages).values(row)).rejects.toMatchObject({ code: '23505' });
    await expect(
      db.insert(ingestMessages).values({ ...row, providerMessageId: 'em_2', status: 'bogus' as never }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.insert(ingestDocuments).values({ restaurantId, messageId: m!.id, status: 'nope' as never }),
    ).rejects.toMatchObject({ code: '23514' });
    await db.insert(ingestDocuments).values({ restaurantId, messageId: m!.id, status: 'needs_review' });
  });

  it('allow-list entries are unique per (restaurant, kind, sender)', async () => {
    await db.insert(ingestSenders).values({ restaurantId, kind: 'whatsapp', sender: '972501234567' });
    await expect(
      db.insert(ingestSenders).values({ restaurantId, kind: 'whatsapp', sender: '972501234567' }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it("0051 adds 'whatsapp' to invoice_source", async () => {
    const rows = (await sql`select unnest(enum_range(null::invoice_source))::text as v`) as unknown as Array<{ v: string }>;
    expect(rows.map((r) => r.v)).toContain('whatsapp');
  });
});

/**
 * Cross-QA (S1): every tenant FK in 0050 is composite (x_id, restaurant_id), so a
 * row can never point at another restaurant's supplier / channel / message /
 * invoice — even on the owner connection that bypasses RLS.
 */
describe('0050 same-tenant composite FKs (attack)', () => {
  const ids = { a: '', b: '', supA: '', supB: '', invB: '', chA: '', chB: '', msgA: '', msgB: '' };

  beforeAll(async () => {
    const [a] = await db.insert(restaurants).values({ name: '0050 tenant A', businessId: '000000501' }).returning();
    const [b] = await db.insert(restaurants).values({ name: '0050 tenant B', businessId: '000000502' }).returning();
    ids.a = a!.id;
    ids.b = b!.id;
    const [sa] = await db.insert(suppliers).values({ restaurantId: ids.a, name: 'Supplier A' }).returning();
    const [sb] = await db.insert(suppliers).values({ restaurantId: ids.b, name: 'Supplier B' }).returning();
    ids.supA = sa!.id;
    ids.supB = sb!.id;
    const [ib] = await db.insert(invoices).values({ restaurantId: ids.b, source: 'email' }).returning();
    ids.invB = ib!.id;
    const [ca] = await db
      .insert(ingestChannels)
      .values({ restaurantId: ids.a, kind: 'email', tokenHash: 'c'.repeat(64), tokenHint: 'cccc' })
      .returning();
    const [cb] = await db
      .insert(ingestChannels)
      .values({ restaurantId: ids.b, kind: 'email', tokenHash: 'd'.repeat(64), tokenHint: 'dddd' })
      .returning();
    ids.chA = ca!.id;
    ids.chB = cb!.id;
    const msg = (restaurantId: string, channelId: string, id: string) => ({
      restaurantId,
      channelId,
      kind: 'email' as const,
      provider: 'stub',
      providerMessageId: id,
      sender: 'x@y.co',
      senderAllowed: false,
      status: 'needs_review' as const,
    });
    const [ma] = await db.insert(ingestMessages).values(msg(ids.a, ids.chA, 'fk-a')).returning();
    const [mb] = await db.insert(ingestMessages).values(msg(ids.b, ids.chB, 'fk-b')).returning();
    ids.msgA = ma!.id;
    ids.msgB = mb!.id;
  });

  afterAll(async () => {
    await db.delete(restaurants).where(eq(restaurants.id, ids.a));
    await db.delete(restaurants).where(eq(restaurants.id, ids.b));
  });

  it("refuses A rows that reference B's supplier, channel, message or invoice (23503)", async () => {
    await expect(
      db.insert(ingestSenders).values({ restaurantId: ids.a, kind: 'email', sender: 'a@b.co', supplierId: ids.supB }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.insert(ingestMessages).values({
        restaurantId: ids.a,
        channelId: ids.chB,
        kind: 'email',
        provider: 'stub',
        providerMessageId: 'fk-x1',
        sender: 'x@y.co',
        senderAllowed: false,
        status: 'needs_review',
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.insert(ingestMessages).values({
        restaurantId: ids.a,
        channelId: ids.chA,
        supplierId: ids.supB,
        kind: 'email',
        provider: 'stub',
        providerMessageId: 'fk-x2',
        sender: 'x@y.co',
        senderAllowed: false,
        status: 'needs_review',
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.insert(ingestDocuments).values({ restaurantId: ids.a, messageId: ids.msgB, status: 'needs_review' }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      db.insert(ingestDocuments).values({ restaurantId: ids.a, messageId: ids.msgA, invoiceId: ids.invB, status: 'registered' }),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('SET NULL clears only the FK column (restaurant_id stays), CASCADE stays within the tenant', async () => {
    const [s] = await db
      .insert(ingestSenders)
      .values({ restaurantId: ids.a, kind: 'email', sender: 'keep@a.co', supplierId: ids.supA })
      .returning();
    const [d] = await db
      .insert(ingestDocuments)
      .values({ restaurantId: ids.a, messageId: ids.msgA, status: 'needs_review' })
      .returning();
    await db.delete(suppliers).where(eq(suppliers.id, ids.supA));
    const [after] = await db.select().from(ingestSenders).where(eq(ingestSenders.id, s!.id));
    expect(after).toMatchObject({ supplierId: null, restaurantId: ids.a });
    // Deleting B's channel cascades to B's message only; A's document is untouched.
    await db.delete(ingestChannels).where(eq(ingestChannels.id, ids.chB));
    expect(await db.select().from(ingestMessages).where(eq(ingestMessages.id, ids.msgB))).toHaveLength(0);
    expect(await db.select().from(ingestDocuments).where(eq(ingestDocuments.id, d!.id))).toHaveLength(1);
  });
});
