import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  poLines,
  purchaseOrders,
  restaurants,
  supplierConfirmLinks,
  supplierResponses,
  suppliers,
  testDbUrl,
  type RestaurantSettings,
} from '@restomatch/db';
import { createSupplierLink, hashSupplierToken, LINK_TTL_MS } from '@restomatch/api';

/**
 * Public POST /api/supplier-confirm/[token] — the attack surface of the supplier
 * portal: body cap, origin, malformed input, guessing, expiry, cross-order lines,
 * replay. Runs the real handler against the test DB.
 */
const { POST } = await import('../route');
const db = createDb(testDbUrl());

let rid: string;
let poId: string;
let lineId: string;
let otherLineId: string;
const tag = `sc-${Date.now()}`;

beforeAll(async () => {
  const [r] = await db
    .insert(restaurants)
    .values({ name: `Portal ${tag}`, settings: { features: { supplierConfirm: true } } as RestaurantSettings })
    .returning();
  rid = r!.id;
  const [s] = await db.insert(suppliers).values({ restaurantId: rid, name: 'ספק פורטל' }).returning();
  const mk = async () => {
    const [po] = await db.insert(purchaseOrders).values({ restaurantId: rid, supplierId: s!.id, status: 'sent', source: 'manual' }).returning();
    const [l] = await db.insert(poLines).values({ poId: po!.id, rawDescription: 'עגבניות', qtyOrdered: '10', unit: 'kg', unitPriceExpected: '8.5' }).returning();
    return { po: po!.id, line: l!.id };
  };
  const a = await mk();
  const b = await mk();
  poId = a.po;
  lineId = a.line;
  otherLineId = b.line;
});

beforeEach(async () => {
  await db.delete(supplierResponses).where(eq(supplierResponses.restaurantId, rid));
  await db.delete(supplierConfirmLinks).where(eq(supplierConfirmLinks.restaurantId, rid));
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.id, rid));
});

function post(token: string, body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = new Request(`http://localhost:3000/api/supplier-confirm/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000', ...headers },
    body: raw,
  });
  return POST(req, { params: Promise.resolve({ token }) });
}

const asOrdered = () => ({ intent: 'as_ordered', lines: [{ poLineId: lineId, qtyAvailable: 10 }] });
const stored = () => db.select().from(supplierResponses).where(eq(supplierResponses.restaurantId, rid));

describe('POST /api/supplier-confirm/[token]', () => {
  it('a valid answer is stored as differences; the PO line is untouched', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    const res = await post(token, { intent: 'with_changes', lines: [{ poLineId: lineId, qtyAvailable: 6, proposedUnitPrice: 9 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'changes' });
    const [line] = await db.select().from(poLines).where(eq(poLines.id, lineId));
    expect(line).toMatchObject({ qtyOrdered: '10.000', unitPriceExpected: '8.5000' });
  });

  it('G-10: `lines: []`, a partial answer or a quantity-less change → 422 incomplete_answer, nothing stored', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    for (const body of [
      { intent: 'as_ordered', lines: [] },
      { intent: 'as_ordered', lines: [], note: 'יגיע מחר בבוקר' },
      { intent: 'with_changes', lines: [{ poLineId: lineId, proposedUnitPrice: 9 }] },
    ]) {
      const res = await post(token, body);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ ok: false, error: 'incomplete_answer' });
    }
    expect(await stored()).toEqual([]);
  });

  it('G-10: an intent that contradicts the lines → 422 intent_mismatch, nothing stored', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    const shortAsOrdered = await post(token, { intent: 'as_ordered', lines: [{ poLineId: lineId, qtyAvailable: 6 }] });
    expect(shortAsOrdered.status).toBe(422);
    expect(await shortAsOrdered.json()).toEqual({ ok: false, error: 'intent_mismatch' });
    const emptyChanges = await post(token, { intent: 'with_changes', lines: [{ poLineId: lineId, qtyAvailable: 10 }] });
    expect(emptyChanges.status).toBe(422);
    expect(await emptyChanges.json()).toEqual({ ok: false, error: 'intent_mismatch' });
    expect(await stored()).toEqual([]);
  });

  it('G-10: a missing or unknown intent → 422 (schema), nothing stored', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    const missing = await post(token, { lines: [{ poLineId: lineId, qtyAvailable: 10 }] });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ ok: false, error: 'invalid input' });
    expect((await post(token, { intent: 'confirm', lines: [{ poLineId: lineId, qtyAvailable: 10 }] })).status).toBe(422);
    expect(await stored()).toEqual([]);
  });

  it('the note rides on "as ordered" with every line → 200, stored with no line changes', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    const res = await post(token, { ...asOrdered(), note: 'יגיע מחר בבוקר' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'changes' });
    const [row] = await stored();
    expect(row).toMatchObject({ note: 'יגיע מחר בבוקר', lines: [] });
  });

  it('replay → 409 carrying the RECORDED answer (never the request); a line from another order → 400; unknown token → 404', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    const foreign = await post(token, { intent: 'with_changes', lines: [{ poLineId: otherLineId, qtyAvailable: 0 }] });
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toEqual({ ok: false, error: 'invalid_lines' });
    expect((await post(token, { intent: 'with_changes', lines: [{ poLineId: lineId, qtyAvailable: 6 }], note: 'רק 6' })).status).toBe(200);
    const replay = await post(token, { ...asOrdered(), note: 'ניסיון שני' });
    expect(replay.status).toBe(409);
    const body = (await replay.json()) as { recorded: { submittedAt: string } };
    expect(body).toEqual({
      ok: false,
      error: 'already_answered',
      recorded: {
        status: 'changes',
        submittedAt: expect.any(String),
        lines: [{ poLineId: lineId, qtyAvailable: 6, proposedUnitPrice: null }],
        note: 'רק 6',
      },
    });
    expect(Number.isNaN(Date.parse(body.recorded.submittedAt))).toBe(false);
    expect(JSON.stringify(body)).not.toContain('ניסיון שני');
    expect(await stored()).toHaveLength(1);
    expect((await post('A'.repeat(43), asOrdered())).status).toBe(404);
    expect((await post('not-a-token', asOrdered())).status).toBe(404);
  });

  it('expired → 410', async () => {
    const { token } = (await createSupplierLink(db, rid, poId, { now: new Date(Date.now() - LINK_TTL_MS - 1000) }))!;
    expect((await post(token, asOrdered())).status).toBe(410);
  });

  it('body cap → 413 (declared and streamed); malformed json → 400; extra keys → 422 (schema); foreign origin → 403', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    const huge = JSON.stringify({ ...asOrdered(), note: 'x'.repeat(20_000) });
    expect((await post(token, huge)).status).toBe(413);
    expect((await post(token, huge, { 'content-length': '10' })).status).toBe(413);
    expect((await post(token, '{not json')).status).toBe(400);
    expect((await post(token, { ...asOrdered(), restaurantId: rid })).status).toBe(422);
    expect((await post(token, asOrdered(), { origin: 'https://evil.example' })).status).toBe(403);
    expect(await db.select().from(supplierResponses).where(eq(supplierResponses.restaurantId, rid))).toEqual([]);
  });

  it('flag off → 404 (the portal disappears)', async () => {
    const { token } = (await createSupplierLink(db, rid, poId))!;
    await db.update(restaurants).set({ settings: {} }).where(eq(restaurants.id, rid));
    try {
      expect((await post(token, asOrdered())).status).toBe(404);
    } finally {
      await db.update(restaurants).set({ settings: { features: { supplierConfirm: true } } as RestaurantSettings }).where(eq(restaurants.id, rid));
    }
    expect(hashSupplierToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
