import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  and,
  createDb,
  eq,
  goodsReceipts,
  invoiceLines,
  invoices,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { ClaudeTranslator, CompositeTranslator, type MessagesClientLike } from '@restomatch/translate';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { __setReceivingTranslator, fillEnglishNames } from '../receiving/english';
import { buildDevOcrStub, devOcrStubEnabled, stubVatRate } from '../receiving/devOcrStub';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());

function callerFor(t: Tenant, role: 'owner' | 'receiver' = 'owner') {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

/** A fake Claude leg: answers every name with "EN(<he>)" and counts calls. */
function fakeClaude() {
  const calls: string[][] = [];
  const client: MessagesClientLike = {
    messages: {
      async create(body) {
        const content = (body.messages as Array<{ content: string }>)[0]!.content;
        const items = JSON.parse(content.slice(content.indexOf('['))) as Array<{ id: number; he: string }>;
        calls.push(items.map((i) => i.he));
        return {
          content: [{ type: 'text', text: JSON.stringify({ items: items.map((i) => ({ id: i.id, en: `EN(${i.he})` })) }) }],
        };
      },
    },
  };
  return { calls, translator: new CompositeTranslator({ claude: new ClaudeTranslator({ client }) }) };
}

let A: Tenant;

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  __setReceivingTranslator(new CompositeTranslator()); // glossary only, offline
});

afterEach(() => {
  __setReceivingTranslator(null);
});

afterAll(async () => {
  await resetDb(db);
});

async function addPoLines(poId: string, names: string[]) {
  return db
    .insert(poLines)
    .values(names.map((n) => ({ poId, rawDescription: n, qtyOrdered: '2', unit: 'ק״ג', unitPriceExpected: '10' })))
    .returning();
}

describe('receiving.ensureEnglish', () => {
  it('fills po_lines, invoice_lines and linked products from the glossary', async () => {
    const [chicken] = await addPoLines(A.poId, ['חזה עוף טרי']);
    const res = await callerFor(A, 'receiver').receiving.ensureEnglish({ poId: A.poId, invoiceId: A.invoiceId });
    expect(res.poLinesFilled).toBe(2);
    expect(res.invoiceLinesFilled).toBe(1);
    expect(res.productsFilled).toBe(1);
    expect(res.claude).toBe(false);

    const [line] = await db.select().from(poLines).where(eq(poLines.id, chicken!.id));
    expect(line?.rawDescriptionEn).toBe('Fresh chicken breast');
    const [seedLine] = await db.select().from(poLines).where(eq(poLines.id, A.poLineId));
    expect(seedLine?.rawDescriptionEn).toBe('Tomatoes A');
    const [product] = await db.select().from(products).where(eq(products.id, A.productId));
    expect(product?.nameEn).toBe('Tomato A');
    const [inv] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, A.invoiceLineId));
    expect(inv?.rawDescriptionEn).toBe('Tomatoes A');
  });

  it('is idempotent and never overwrites an existing English name', async () => {
    await db.update(poLines).set({ rawDescriptionEn: 'Hand-typed' }).where(eq(poLines.id, A.poLineId));
    const caller = callerFor(A);
    await caller.receiving.ensureEnglish({ poId: A.poId });
    const second = await caller.receiving.ensureEnglish({ poId: A.poId });
    expect(second.poLinesFilled).toBe(0);
    expect(second.productsFilled).toBe(0);
    const [line] = await db.select().from(poLines).where(eq(poLines.id, A.poLineId));
    expect(line?.rawDescriptionEn).toBe('Hand-typed');
  });

  it('uses Claude only for glossary misses, in one batch, and never twice for the same row', async () => {
    await addPoLines(A.poId, ['שמשון הגיבור', 'חזה עוף']);
    const { calls, translator } = fakeClaude();
    __setReceivingTranslator(translator);
    const res = await callerFor(A).receiving.ensureEnglish({ poId: A.poId });
    expect(res.claude).toBe(true);
    expect(calls).toEqual([['שמשון הגיבור']]);
    const rows = await db.select().from(poLines).where(eq(poLines.poId, A.poId));
    expect(rows.find((r) => r.rawDescription === 'שמשון הגיבור')?.rawDescriptionEn).toBe('EN(שמשון הגיבור)');
    expect(rows.find((r) => r.rawDescription === 'חזה עוף')?.rawDescriptionEn).toBe('Chicken breast');

    // Second run: every row already has English → no Claude call at all.
    const { calls: calls2, translator: t2 } = fakeClaude();
    __setReceivingTranslator(t2);
    await callerFor(A).receiving.ensureEnglish({ poId: A.poId });
    expect(calls2).toEqual([]);
  });

  it('leaves untranslatable names NULL offline (UI falls back to Hebrew)', async () => {
    await addPoLines(A.poId, ['שמשון הגיבור']);
    const res = await callerFor(A).receiving.ensureEnglish({ poId: A.poId });
    expect(res.untranslated).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(poLines).where(eq(poLines.poId, A.poId));
    expect(rows.find((r) => r.rawDescription === 'שמשון הגיבור')?.rawDescriptionEn).toBeNull();
  });

  it('requires poId or invoiceId', async () => {
    await expect(callerFor(A).receiving.ensureEnglish({})).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('fillEnglishNames never touches another tenant\'s product linked from a line', async () => {
    const B = await seedTenant(db, 'B');
    // A's PO line pointing at B's product (corrupt / hostile link) — B's product must stay NULL.
    await db.insert(poLines).values({ poId: A.poId, productId: B.productId, rawDescription: 'חלב', qtyOrdered: '1', unit: 'ל׳' });
    await fillEnglishNames(db, A.restaurantId, { poId: A.poId });
    const [bProduct] = await db.select().from(products).where(eq(products.id, B.productId));
    expect(bProduct?.nameEn).toBeNull();
  });
});

describe('receiving reads expose English for the wizard', () => {
  it('getPo / getReceipt / getInvoice return the English columns', async () => {
    await callerFor(A).receiving.ensureEnglish({ poId: A.poId, invoiceId: A.invoiceId });
    const caller = callerFor(A);
    const po = await caller.receiving.getPo({ poId: A.poId });
    expect(po.lines[0]?.rawDescriptionEn).toBe('Tomatoes A');
    expect(po).toHaveProperty('supplierNameEn');
    const receipt = await caller.receiving.getReceipt({ grId: A.grId });
    expect(receipt.lines[0]?.productNameEn).toBeTruthy();
    const inv = await caller.receiving.getInvoice({ invoiceId: A.invoiceId });
    expect(inv.lines[0]?.rawDescriptionEn).toBe('Tomatoes A');
    expect(inv.lines[0]?.productNameEn).toBe('Tomato A');
    expect(inv.supplierName).toBe('ספק A');
  });

  it('correcting a line description clears its stale English', async () => {
    const caller = callerFor(A);
    await caller.receiving.ensureEnglish({ invoiceId: A.invoiceId });
    await caller.receiving.updateInvoiceLine({ lineId: A.invoiceLineId, patch: { rawDescription: 'מלפפון' } });
    const [line] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, A.invoiceLineId));
    expect(line?.rawDescriptionEn).toBeNull();
    await caller.receiving.ensureEnglish({ invoiceId: A.invoiceId });
    const [again] = await db.select().from(invoiceLines).where(eq(invoiceLines.id, A.invoiceLineId));
    expect(again?.rawDescriptionEn).toBe('Cucumber');
  });
});

describe('R5 — receiving inbox shows POs without a delivery date', () => {
  it('lists a recent undated open PO (flagged), but not an old one or a draft', async () => {
    const [undated] = await db
      .insert(purchaseOrders)
      .values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'sent', source: 'manual' })
      .returning();
    const old = new Date(Date.now() - 40 * 86_400_000);
    await db.insert(purchaseOrders).values({
      restaurantId: A.restaurantId,
      supplierId: A.supplierId,
      status: 'sent',
      source: 'manual',
      createdAt: old,
    });
    await db.insert(purchaseOrders).values({ restaurantId: A.restaurantId, supplierId: A.supplierId, status: 'draft', source: 'manual' });

    const list = await callerFor(A, 'receiver').receiving.todayExpectations();
    expect(list.map((e) => e.poId).sort()).toEqual([A.poId, undated!.id].sort());
    const u = list.find((e) => e.poId === undated!.id)!;
    expect(u.hasDeliveryDate).toBe(false);
    expect(Number.isNaN(Date.parse(u.expectedAt))).toBe(false);
    expect(list.find((e) => e.poId === A.poId)!.hasDeliveryDate).toBe(true);
    // Dated deliveries sort first.
    expect(list[0]!.poId).toBe(A.poId);
  });
});

describe('M8 — registerInvoice double-tap', () => {
  async function receiptId() {
    const [gr] = await db.select({ id: goodsReceipts.id }).from(goodsReceipts).where(eq(goodsReceipts.poId, A.poId));
    return gr!.id;
  }

  it('two CONCURRENT registrations of the same scan create exactly one invoice', async () => {
    const grId = await receiptId();
    const caller = callerFor(A, 'receiver');
    const input = { grId, imageUrl: 'https://example.com/scan-1.jpg', supplierId: A.supplierId };
    const [a, b] = await Promise.all([
      caller.receiving.registerInvoice(input),
      caller.receiving.registerInvoice(input),
    ]);
    expect(a.invoiceId).toBe(b.invoiceId);
    expect([a.alreadyExisted, b.alreadyExisted].sort()).toEqual([false, true]);
    const rows = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.restaurantId, A.restaurantId), eq(invoices.rawImageUrl, input.imageUrl)));
    expect(rows).toHaveLength(1);
  });

  it('a re-signed URL for the same object (new token) is the same invoice', async () => {
    const grId = await receiptId();
    const caller = callerFor(A, 'receiver');
    const first = await caller.receiving.registerInvoice({
      grId,
      imageUrl: 'https://example.com/obj/scan-2.jpg?token=one',
      supplierId: A.supplierId,
    });
    const second = await caller.receiving.registerInvoice({
      grId,
      imageUrl: 'https://example.com/obj/scan-2.jpg?token=two',
      supplierId: A.supplierId,
    });
    expect(second.invoiceId).toBe(first.invoiceId);
    expect(second.alreadyExisted).toBe(true);
  });
});

describe('local-demo OCR stub', () => {
  it('is never enabled in production or when a real key is configured', () => {
    expect(devOcrStubEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(devOcrStubEnabled({ NODE_ENV: 'development', ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(false);
    expect(devOcrStubEnabled({ NODE_ENV: 'development', OCR_DEV_STUB: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(devOcrStubEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('builds a deterministic invoice from the receipt PO with a visible price deviation', async () => {
    await addPoLines(A.poId, ['חזה עוף', 'מלפפון']);
    const stub = await buildDevOcrStub(db, A.restaurantId, A.grId);
    expect(stub).not.toBeNull();
    expect(stub!.lines).toHaveLength(3);
    // Lines follow PO-line order; the FIRST line is billed ~8% over its
    // agreed price, the SECOND one unit over the ordered qty.
    const po = await db.select().from(poLines).where(eq(poLines.poId, A.poId)).orderBy(poLines.id);
    const [first, second] = po;
    expect(stub!.lines[0]!.rawDescription).toBe(first!.rawDescription);
    expect(stub!.lines[0]!.unitPrice).toBeCloseTo(Number(first!.unitPriceExpected) * 1.08, 2);
    expect(stub!.lines[1]!.qty).toBe(Number(second!.qtyOrdered) + 1);
    const subtotal = stub!.lines.reduce((s, l) => s + l.lineTotal, 0);
    expect(stub!.totals.subtotal).toBeCloseTo(subtotal, 2);
  });

  it('bills VAT at the rate the matcher expects: PO → supplier → restaurant → 18%', async () => {
    expect(stubVatRate(null, '0.0000', '0.1800')).toBe(0);
    expect(stubVatRate('0.1700', '0', '0.18')).toBe(0.17);
    expect(stubVatRate(null, null, '0.1800')).toBe(0.18);
    expect(stubVatRate(null, null, null)).toBe(0.18);
    // A 0%-VAT produce supplier: no VAT on the stub invoice (no false VAT_MISMATCH).
    await db.update(purchaseOrders).set({ vatRate: null }).where(eq(purchaseOrders.id, A.poId));
    await db.update(suppliers).set({ vatRate: '0' }).where(eq(suppliers.id, A.supplierId));
    await db.update(restaurants).set({ vatRate: '0.18' }).where(eq(restaurants.id, A.restaurantId));
    const zero = await buildDevOcrStub(db, A.restaurantId, A.grId);
    expect(zero!.totals.vat).toBe(0);
    expect(zero!.totals.total).toBe(zero!.totals.subtotal);
    expect(zero!.lines.every((l) => l.vatRate === 0)).toBe(true);
    // No rate on supplier or PO: the restaurant's.
    await db.update(suppliers).set({ vatRate: null }).where(eq(suppliers.id, A.supplierId));
    const std = await buildDevOcrStub(db, A.restaurantId, A.grId);
    expect(std!.totals.vat).toBeCloseTo(Math.round(std!.totals.subtotal * 18) / 100, 2);
  });

  it('refuses a foreign receipt', async () => {
    const B = await seedTenant(db, 'B');
    expect(await buildDevOcrStub(db, A.restaurantId, B.grId)).toBeNull();
  });
});

describe('EN-3 — a failed OCR is visible, never silent', () => {
  it('getInvoice exposes ocrFailed + reason (and never the raw payload)', async () => {
    await db
      .update(invoices)
      .set({
        status: 'parsed',
        ocrPayload: { provider: 'claude_vision', raw: { ocrFailed: true, reason: 'quota_exceeded' } },
      })
      .where(eq(invoices.id, A.invoiceId));
    const inv = await callerFor(A).receiving.getInvoice({ invoiceId: A.invoiceId });
    expect(inv.ocrFailed).toBe(true);
    expect(inv.ocrFailureReason).toBe('quota_exceeded');
    expect(inv).not.toHaveProperty('ocrPayload');
  });

  it('a normal invoice reports ocrFailed=false', async () => {
    const inv = await callerFor(A).receiving.getInvoice({ invoiceId: A.invoiceId });
    expect(inv.ocrFailed).toBe(false);
    expect(inv.ocrFailureReason).toBeNull();
  });
});

describe('EN-BUDGET-1 — the Claude budget is charged only for real Claude calls', () => {
  it('glossary-covered pages never consume budget; a real miss consumes exactly one unit', async () => {
    const { CLAUDE_CALLS_PER_RESTAURANT_PER_HOUR, __resetClaudeBudget, takeClaudeBudget } = await import(
      '../receiving/english'
    );
    __resetClaudeBudget();
    const { translator } = fakeClaude();
    __setReceivingTranslator(translator);
    // Every name on the seeded PO is in the glossary → no budget spent, however often.
    for (let i = 0; i < CLAUDE_CALLS_PER_RESTAURANT_PER_HOUR + 5; i += 1) {
      const r = await callerFor(A).receiving.ensureEnglish({ poId: A.poId });
      expect(r.claude).toBe(false);
    }
    // One unit used by a real miss, the rest still available.
    await addPoLines(A.poId, ['שמשון הגיבור']);
    const r = await callerFor(A).receiving.ensureEnglish({ poId: A.poId });
    expect(r.claude).toBe(true);
    let left = 0;
    while (takeClaudeBudget(A.restaurantId)) left += 1;
    expect(left).toBe(CLAUDE_CALLS_PER_RESTAURANT_PER_HOUR - 1);
    __resetClaudeBudget();
  });
});
