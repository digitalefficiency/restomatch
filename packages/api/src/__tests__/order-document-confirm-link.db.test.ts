import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  eq,
  notificationsOutbox,
  restaurants,
  supplierConfirmLinks,
  suppliers,
  testDbUrl,
} from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import type { OrderDocument } from '../orders/document';
import { ORDER_DOCUMENT_EXTENSIONS } from '../orders/document';
import {
  SUPPLIER_CONFIRM_DOC_LINE_HE,
  SUPPLIER_CONFIRM_DOC_PREVIEW_HE,
  supplierConfirmDocumentExtension,
} from '../supplierConfirm/documentExtension';
import { resolveSupplierToken } from '../supplierConfirm/service';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * S11's supplier-confirmation link registered in S5's priced supplier document
 * (ORDER_DOCUMENT_EXTENSIONS): the email text, the WhatsApp text and the PDF
 * carry a live /s/<token> link only when the order is SENT (mode 'send'); the
 * PO page's preview shows a static hint and never mints a link.
 *
 * The PDF is drawn from `doc.extraLines`; its glyphs are font-encoded, so the
 * test captures the document each PDF is rendered from (a pass-through mock).
 */
const pdfDocs: OrderDocument[] = [];
vi.mock('../orders/document/pdf', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../orders/document/pdf')>();
  return {
    ...orig,
    renderOrderPdf: async (doc: OrderDocument) => {
      pdfDocs.push(doc);
      return orig.renderOrderPdf(doc);
    },
  };
});

const db = createDb(testDbUrl());
let A: Tenant;

const LINK_PREFIX = SUPPLIER_CONFIRM_DOC_LINE_HE.replace('{url}', '');
const LINK_RE = /https?:\/\/\S+\/s\/([A-Za-z0-9_-]{43})/;

function callerFor(tenant: Tenant, role: Session['role'] = 'owner') {
  const ctx: AppContext = { db, session: { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role } };
  return appRouter.createCaller(ctx);
}

async function setFeatures(features: Record<string, boolean>) {
  await db.update(restaurants).set({ settings: { features } } as never).where(eq(restaurants.id, A.restaurantId));
}

async function draft(): Promise<string> {
  await db
    .update(suppliers)
    .set({ contactEmail: 'orders@supplier.test', contactWhatsapp: '+972500000000' })
    .where(eq(suppliers.id, A.supplierId));
  const { poId } = await callerFor(A).orders.createDraft({
    supplierId: A.supplierId,
    lines: [{ productId: A.productId, rawDescription: 'עגבניות', qty: 2, unit: 'ק״ג', unitPriceExpected: 7.5 }],
  });
  return poId;
}

async function outboxBody(poId: string): Promise<string> {
  const rows = await db.select().from(notificationsOutbox).where(eq(notificationsOutbox.relatedEntityId, poId));
  expect(rows).toHaveLength(1);
  return rows[0]!.body;
}

const linksFor = (poId: string) => db.select().from(supplierConfirmLinks).where(eq(supplierConfirmLinks.poId, poId));

beforeEach(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  pdfDocs.length = 0;
});
afterAll(async () => {
  await resetDb(db);
});

describe('ORDER_DOCUMENT_EXTENSIONS registers S11 supplier confirmation', () => {
  it('is wired into the supplier document', () => {
    expect(ORDER_DOCUMENT_EXTENSIONS).toContain(supplierConfirmDocumentExtension);
  });
});

describe("mode 'send' (orders.placeOrder) — the document carries a live confirmation link", () => {
  it('email text and its PDF carry the same link to THIS order; exactly one link is minted', async () => {
    await setFeatures({ orderPricesOut: true, supplierConfirm: true });
    const poId = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });

    const body = await outboxBody(poId);
    const line = body.split('\n').find((l) => l.startsWith(LINK_PREFIX));
    expect(line).toBeDefined();
    const token = LINK_RE.exec(line!)?.[1];
    expect(token).toBeDefined();
    expect(body).not.toContain(SUPPLIER_CONFIRM_DOC_PREVIEW_HE);

    // The PDF attached to that email was drawn from a document carrying the same line.
    expect(pdfDocs).toHaveLength(1);
    expect(pdfDocs[0]!.extraLines).toEqual([line]);

    expect(await linksFor(poId)).toHaveLength(1);
    const resolved = await resolveSupplierToken(db, token!);
    expect(resolved.ok && resolved.link.poId).toBe(poId);
    expect(resolved.ok && resolved.link.restaurantId).toBe(A.restaurantId);
  });

  it('WhatsApp text carries the link (no PDF on WhatsApp)', async () => {
    await setFeatures({ all: true });
    const poId = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'whatsapp' });

    const body = await outboxBody(poId);
    const line = body.split('\n').find((l) => l.startsWith(LINK_PREFIX));
    expect(line).toMatch(LINK_RE);
    expect(pdfDocs).toHaveLength(0);
    expect(await linksFor(poId)).toHaveLength(1);
  });

  it('flag supplierConfirm off → no link line, nothing minted (document unchanged)', async () => {
    await setFeatures({ orderPricesOut: true });
    const poId = await draft();
    await callerFor(A).orders.placeOrder({ poId, channel: 'email' });

    const body = await outboxBody(poId);
    expect(body).not.toContain(LINK_PREFIX);
    expect(body).not.toMatch(LINK_RE);
    expect(pdfDocs[0]!.extraLines).toEqual([]);
    expect(await linksFor(poId)).toHaveLength(0);
  });
});

describe("mode 'preview' (orders.documentPreview) — never a link", () => {
  it('email, WhatsApp and PDF show the static hint; no link is minted', async () => {
    await setFeatures({ orderPricesOut: true, supplierConfirm: true });
    const poId = await draft();
    // Preview a SENT order: the confirm link is mintable, yet preview must not mint it.
    await db.update(suppliers).set({ contactEmail: null, contactWhatsapp: null }).where(eq(suppliers.id, A.supplierId));
    await callerFor(A).orders.placeOrder({ poId, channel: 'none' });
    expect(await linksFor(poId)).toHaveLength(0);

    const out = await callerFor(A).orders.documentPreview({ poId });
    for (const text of [out.emailText, out.whatsappText]) {
      expect(text).toContain(SUPPLIER_CONFIRM_DOC_PREVIEW_HE);
      expect(text).not.toContain(LINK_PREFIX);
      expect(text).not.toMatch(LINK_RE);
    }
    expect(pdfDocs).toHaveLength(1);
    expect(pdfDocs[0]!.extraLines).toEqual([SUPPLIER_CONFIRM_DOC_PREVIEW_HE]);
    expect(await linksFor(poId)).toHaveLength(0);
  });
});
