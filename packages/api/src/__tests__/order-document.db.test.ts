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
    expect(row.body).toBe(
      ['הזמנה לספק ספק A', '• עגבניות — 2.500 ק״ג', '• מלפפונים — 3.000 ק״ג', '• פטרוזיליה — 1.000 צרור'].join('\n'),
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
    expect(row.body).toContain('ללא מחיר מוסכם');
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
