import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  ingestChannels,
  ingestDocuments,
  ingestMessages,
  ingestSenders,
  restaurants,
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
