import { testDbUrl } from '@restomatch/db';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  eq,
  notificationsOutbox,
  restaurants,
  supplierCatalogItems,
  suppliers,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';
import { orderDocumentContractPrices } from '../orders/document';
import { poRefOf } from '../orders/supplierMessage';

/**
 * Flag `orderPricesOut`: the supplier-facing order carries SKU, agreed unit
 * price, line + order totals (integer agorot), and email gets a PDF. With the
 * flag off the outbox body is exactly today's "item — quantity" text.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

async function setFeatures(features: Record<string, boolean>, extra: Record<string, unknown> = {}) {
  await db.update(restaurants).set({ settings: { features, ...extra } } as never).where(eq(restaurants.id, A.restaurantId));
}

async function draft() {
  await db
    .update(suppliers)
    .set({ contactEmail: 'orders@supplier.test', contactWhatsapp: '+972500000000' })
    .where(eq(suppliers.id, A.supplierId));
  await db.insert(supplierCatalogItems).values({
    restaurantId: A.restaurantId,
    supplierId: A.supplierId,
    productId: A.productId,
    supplierSku: 'TOM-01',
    supplierNameRaw: 'עגבניות',
  });
  return callerFor(A).orders.createDraft({
    supplierId: A.supplierId,
    lines: [
      { productId: A.productId, rawDescription: 'עגבניות', qty: 2.5, unit: 'ק״ג', unitPriceExpected: 7.333 },
      { rawDescription: 'מלפפונים', qty: 3, unit: 'ק״ג', unitPriceExpected: 4.2 },
      { rawDescription: 'פטרוזיליה', qty: 1, unit: 'צרור' },
    ],
  });
}

async function outboxFor(poId: string) {
  const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityId, poId));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});
afterEach(() => {
  delete process.env.FEATURES_OFF;
});
afterAll(async () => {
  await resetDb(db);
});

describe('orders.placeOrder — flag orderPricesOut off', () => {
  it('queues the legacy item — quantity text with no prices and no attachment', async () => {
    const { poId } = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    const row = await outboxFor(poId);
    // #100's supplier-message contract (orders/supplierMessage.ts), the same text
    // orders.supplierMessagePreview shows: header, contact, PO ref, delivery,
    // items in PO_LINE_ORDER with trimmed quantities, item count. No prices.
    expect(row.body).toBe(
      [
        'הזמנה לספק ספק A',
        'מאת: Resto A',
        'איש קשר: Owner A · owner-A@attack.test',
        `מס׳ הזמנה: ${poRefOf(poId)}`,
        'אספקה מבוקשת: לתיאום מול המסעדה',
        '',
        '• מלפפונים — 3 ק״ג',
        '• עגבניות — 2.5 ק״ג',
        '• פטרוזיליה — 1 צרור',
        '',
        'סה״כ 3 פריטים',
      ].join('\n'),
    );
    expect(row.payload ?? {}).not.toHaveProperty('__attachments');
  });

  it('the FEATURES_OFF kill-switch wins over settings.features.all', async () => {
    await setFeatures({ all: true });
    process.env.FEATURES_OFF = 'orderPricesOut';
    const { poId } = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    const row = await outboxFor(poId);
    expect(row.body).not.toContain('₪');
    expect(row.body.startsWith('הזמנה לספק ')).toBe(true);
  });
});

describe('orders.placeOrder — flag orderPricesOut on', () => {
  it('email: SKU, agreed prices, agorot-exact totals, and a PDF attachment', async () => {
    await setFeatures({ orderPricesOut: true });
    const { poId } = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    const row = await outboxFor(poId);
    // 2.5 × 7.333 = 18.3325 → ₪18.33 (half-up); 3 × 4.2 = ₪12.60; total ₪30.93.
    expect(row.body).toContain('מק״ט TOM-01');
    expect(row.body).toContain('18.33');
    expect(row.body).toContain('12.60');
    expect(row.body).toContain('30.93');
    expect(row.body).toContain('ללא מחיר');
    // No contracts module on this base: no price is called agreed.
    expect(row.body).not.toMatch(/מוסכ|חוזה/);
    const atts = (row.payload as { __attachments?: Array<Record<string, string>> }).__attachments;
    expect(atts).toHaveLength(1);
    expect(atts![0]).toMatchObject({ contentType: 'application/pdf' });
    expect(atts![0]!.filename).toMatch(/^order-[0-9A-F]{8}\.pdf$/);
    expect(Buffer.from(atts![0]!.contentBase64!, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('whatsapp: compact priced text, no attachment', async () => {
    await setFeatures({ all: true });
    const { poId } = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'whatsapp' });
    const row = await outboxFor(poId);
    expect(row.channel).toBe('whatsapp');
    expect(row.body).toContain('[TOM-01]');
    expect(row.body).toContain('30.93');
    expect(row.payload ?? {}).not.toHaveProperty('__attachments');
  });

  it('a restaurant that hides prices sends quantities + SKU only', async () => {
    await setFeatures({ orderPricesOut: true });
    await callerFor(A).orders.setDocumentSettings({ showPrices: false });
    const { poId } = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    const row = await outboxFor(poId);
    expect(row.body).toContain('TOM-01');
    expect(row.body).not.toContain('₪');
    expect(row.body).not.toContain('30.93');
  });
});

describe('order document settings + preview', () => {
  it('settings default to show prices and are hidden while the flag is off', async () => {
    expect(await callerFor(A).orders.documentSettings()).toEqual({ enabled: false, showPrices: true });
    await expect(callerFor(A).orders.setDocumentSettings({ showPrices: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'FEATURE_DISABLED' },
    });
    await expect(callerFor(A).orders.documentPreview({ poId: A.poId })).rejects.toMatchObject({
      cause: { appCode: 'FEATURE_DISABLED' },
    });
  });

  it('setDocumentSettings keeps the other settings and is manager-only', async () => {
    await setFeatures({ orderPricesOut: true }, { tolerances: { pricePercent: 3 } });
    await callerFor(A, 'manager').orders.setDocumentSettings({ showPrices: false });
    const [r] = await db.select({ settings: restaurants.settings }).from(restaurants).where(eq(restaurants.id, A.restaurantId));
    expect(r?.settings).toMatchObject({
      features: { orderPricesOut: true },
      tolerances: { pricePercent: 3 },
      orderDocument: { showPrices: false },
    });
    expect(await callerFor(A).orders.documentSettings()).toEqual({ enabled: true, showPrices: false });
    for (const role of ['receiver', 'bookkeeper', 'chef'] as const) {
      await expect(callerFor(A, role).orders.setDocumentSettings({ showPrices: true })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });

  it('documentPreview returns the texts and the PDF without sending anything', async () => {
    await setFeatures({ orderPricesOut: true });
    const { poId } = await draft();
    const out = await callerFor(A).orders.documentPreview({ poId });
    expect(out.totalAgorot).toBe(3093);
    expect(out.hasUnpricedLines).toBe(true);
    expect(out.emailText).toContain('TOM-01');
    expect(out.whatsappText).toContain('30.93');
    expect(Buffer.from(out.pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityId, poId));
    expect(rows).toHaveLength(0);
  });
});

// The integration wiring (orders/document/index.ts) registers S11's contractPricesForOrder.
const wiredContractPrices = orderDocumentContractPrices.resolve;

describe('contract prices ("agreed") on the supplier document', () => {
  afterEach(() => {
    orderDocumentContractPrices.resolve = wiredContractPrices;
  });

  async function preview() {
    const { poId } = await draft();
    return callerFor(A).orders.documentPreview({ poId });
  }

  it('a line is "מחיר חוזה" only when its PO price is the contract price in force (flag contracts on)', async () => {
    await setFeatures({ orderPricesOut: true, contracts: true });
    orderDocumentContractPrices.resolve = async (_db, _r, _s, items) =>
      new Map(items.map((i) => [`${i.productId}|${i.unit}`, 7.333]));
    const out = await preview();
    expect(out.emailText).toContain('(מחיר חוזה)');
    expect(out.emailText).toContain('מחירים המסומנים "מחיר חוזה"');
  });

  it('a different contract price is not claimed as agreed', async () => {
    await setFeatures({ orderPricesOut: true, contracts: true });
    orderDocumentContractPrices.resolve = async (_db, _r, _s, items) =>
      new Map(items.map((i) => [`${i.productId}|${i.unit}`, 7.0]));
    const out = await preview();
    expect(out.emailText).not.toMatch(/מוסכ|חוזה/);
  });

  it('with flag contracts off nothing is called agreed, even with a resolver registered', async () => {
    await setFeatures({ orderPricesOut: true });
    let called = false;
    orderDocumentContractPrices.resolve = async () => {
      called = true;
      return new Map();
    };
    const out = await preview();
    expect(called).toBe(false);
    expect(out.emailText).not.toMatch(/מוסכ|חוזה/);
    expect(out.emailText).toContain('המחירים הם מחירי ההזמנה.');
  });
});

describe('contract prices — integration wiring (S11 contractPricesForOrder)', () => {
  it('the API registers contractPricesForOrder as the document resolver', async () => {
    const { contractPricesForOrder } = await import('../contracts/orderPrices');
    expect(wiredContractPrices).toBe(contractPricesForOrder);
  });

  it('documentPreview and placeOrder call a real contract price "agreed" (flag contracts on)', async () => {
    await setFeatures({ orderPricesOut: true, contracts: true });
    const { poId } = await draft();
    // The PO prices tomatoes at 7.333 / ק״ג; the contract in force says the same.
    await callerFor(A).contracts.create({
      supplierId: A.supplierId,
      productId: A.productId,
      contractPrice: 7.333,
      unit: 'ק״ג',
      validFrom: '2020-01-01',
    });
    const out = await callerFor(A).orders.documentPreview({ poId });
    const tomato = out.emailText.split('\n').find((l) => l.includes('TOM-01'));
    expect(tomato).toContain('(מחיר חוזה)');
    // The cucumber line has no product → never a contract line.
    expect(out.emailText.split('\n').find((l) => l.includes('מלפפונים'))).not.toContain('מחיר חוזה');
    expect(out.emailText).toContain('מחירים המסומנים "מחיר חוזה"');

    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });
    const row = await outboxFor(poId);
    expect(row.body).toContain('(מחיר חוזה)');
    expect(row.body).toContain('מחירים המסומנים "מחיר חוזה"');
  });

  it('a contract price that differs from the PO price is not "agreed"', async () => {
    await setFeatures({ orderPricesOut: true, contracts: true });
    const { poId } = await draft();
    await callerFor(A).contracts.create({
      supplierId: A.supplierId,
      productId: A.productId,
      contractPrice: 7.0,
      unit: 'ק״ג',
      validFrom: '2020-01-01',
    });
    const out = await callerFor(A).orders.documentPreview({ poId });
    expect(out.emailText).not.toMatch(/מוסכ|חוזה/);
    expect(out.emailText).toContain('המחירים הם מחירי ההזמנה.');
  });
});
