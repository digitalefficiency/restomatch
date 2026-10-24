/**
 * Local-demo OCR stub. With no ANTHROPIC_API_KEY the worker refuses to OCR (by
 * design — see apps/worker/src/jobs/ocrInvoice.ts), which made the upload flow
 * dead-end on localhost. Outside production, registerInvoice instead attaches a
 * deterministic "extraction" built from the receipt's PO, through the worker's
 * existing `mockProviders` path, so scan → OCR → reconcile → confirm runs end
 * to end without credentials or spend.
 *
 * NEVER active in production (NODE_ENV === 'production'), never when a real key
 * is configured, and switchable off with OCR_DEV_STUB=0.
 */
import { and, asc, eq, goodsReceipts, poLines, restaurants, suppliers, purchaseOrders, type Database } from '@restomatch/db';
import type { InvoiceOcrResult } from '@restomatch/types';

export function devOcrStubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  if (env.ANTHROPIC_API_KEY) return false;
  return env.OCR_DEV_STUB !== '0';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** First configured rate (numeric string) wins — PO, supplier, restaurant — else 18%. */
export function stubVatRate(...rates: Array<string | null | undefined>): number {
  for (const r of rates) if (r != null) return Number(r);
  return 0.18;
}

/**
 * Build the stub invoice for the PO behind `grId`. Deterministic, with two
 * realistic deviations so the reconciliation screen has something to show:
 * line 1 billed ~8% above the agreed price, line 2 billed one unit more than
 * ordered. Returns null when the receipt has no PO lines.
 */
export async function buildDevOcrStub(
  db: Database,
  restaurantId: string,
  grId: string,
): Promise<InvoiceOcrResult | null> {
  const [gr] = await db
    .select({
      poId: goodsReceipts.poId,
      supplierName: suppliers.name,
      poVat: purchaseOrders.vatRate,
      supplierVat: suppliers.vatRate,
      restaurantVat: restaurants.vatRate,
    })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(restaurants, eq(restaurants.id, goodsReceipts.restaurantId))
    .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.restaurantId, restaurantId)))
    .limit(1);
  if (!gr?.poId) return null;

  const rows = await db
    .select({
      description: poLines.rawDescription,
      descriptionEn: poLines.rawDescriptionEn,
      qty: poLines.qtyOrdered,
      unit: poLines.unit,
      price: poLines.unitPriceExpected,
    })
    .from(poLines)
    .where(eq(poLines.poId, gr.poId))
    .orderBy(asc(poLines.id));
  if (rows.length === 0) return null;
  // Bill VAT at the rate the matcher expects (PO → supplier → restaurant → 18%,
  // as buildMatchInputForInvoice), so a 0%-VAT produce supplier gets no false
  // VAT_MISMATCH from the stub — the only deviations are the two below.
  const vatRate = stubVatRate(gr.poVat, gr.supplierVat, gr.restaurantVat);

  const lines = rows.map((r, i) => {
    const ordered = Number(r.qty);
    const agreed = r.price != null ? Number(r.price) : 10;
    const unitPrice = i === 0 ? round2(agreed * 1.08) : agreed;
    const qty = i === 1 && rows.length > 2 ? ordered + 1 : ordered;
    return {
      rawDescription: r.description ?? `פריט ${i + 1}`,
      ...(r.descriptionEn ? { rawDescriptionEn: r.descriptionEn } : {}),
      qty,
      unit: r.unit,
      unitPrice,
      lineTotal: round2(qty * unitPrice),
      vatRate,
      confidence: 0.97,
    };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const vat = round2(subtotal * vatRate);
  return {
    supplier: { name: gr.supplierName },
    invoiceNumber: `DEV-${Date.now().toString(36).toUpperCase()}`,
    invoiceDate: new Date().toISOString().slice(0, 10),
    allocationNumber: null,
    lines,
    totals: { subtotal, vat, total: round2(subtotal + vat) },
    confidence: 0.96,
  };
}
