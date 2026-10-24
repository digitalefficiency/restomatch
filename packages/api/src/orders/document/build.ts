import type { OrderDocument, OrderDocumentExtension, OrderDocumentExtensionContext, OrderDocumentLine } from './types';

/** NUMERIC string (≤ 4 decimals) → integer units of 10^-scale, half-up, exact. */
export function decimalToScaled(value: string | number | null | undefined, scale: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!m) return null;
  const frac = (m[3] ?? '').padEnd(scale + 1, '0');
  const v = Number(m[2]) * 10 ** scale + Number(frac.slice(0, scale)) + (Number(frac[scale]) >= 5 ? 1 : 0);
  return m[1] ? -v : v;
}

/**
 * qty (NUMERIC(12,3)) × unit price (NUMERIC(12,4)) → line total in agorot,
 * half-up, in integers: qty in thousandths × price in 1/100 agorot gives
 * 10^-5 agorot units, rounded once.
 */
export function lineTotalAgorot(qty: string, unitPrice: string): number | null {
  const q = decimalToScaled(qty, 3);
  const p = decimalToScaled(unitPrice, 4); // 1/10 000 shekel = 1/100 agora
  if (q === null || p === null) return null;
  const units = BigInt(q) * BigInt(p); // 10^-3 qty × 10^-2 agora = 10^-5 agora
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const agorot = Number((abs + 50_000n) / 100_000n);
  return neg ? -agorot : agorot;
}

export interface BuildOrderDocumentInput {
  restaurantName: string;
  supplierName: string;
  poId: string;
  placedAt: Date;
  expectedDeliveryAt: Date | null;
  timezone: string;
  notes?: string | null;
  showPrices: boolean;
  lines: Array<{
    rawDescription: string | null;
    supplierSku: string | null;
    qtyOrdered: string;
    unit: string;
    unitPriceExpected: string | null;
  }>;
  /** Extra lines appended after the totals (see `applyOrderDocumentExtensions`). */
  extraLines?: string[];
}

function localDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

export function buildOrderDocument(input: BuildOrderDocumentInput): OrderDocument {
  const lines: OrderDocumentLine[] = input.lines.map((l) => {
    const unitPriceAgorot = l.unitPriceExpected !== null ? decimalToScaled(l.unitPriceExpected, 2) : null;
    return {
      description: (l.rawDescription ?? '').trim() || 'פריט',
      sku: l.supplierSku?.trim() || null,
      qty: l.qtyOrdered,
      unit: l.unit,
      unitPriceAgorot,
      lineTotalAgorot: l.unitPriceExpected !== null ? lineTotalAgorot(l.qtyOrdered, l.unitPriceExpected) : null,
    };
  });
  const doc: OrderDocument = {
    restaurantName: input.restaurantName,
    supplierName: input.supplierName,
    orderRef: input.poId.replace(/-/g, '').slice(0, 8).toUpperCase(),
    deliveryDate: input.expectedDeliveryAt ? localDate(input.expectedDeliveryAt, input.timezone) : null,
    orderDate: localDate(input.placedAt, input.timezone),
    lines,
    totalAgorot: lines.reduce((s, l) => s + (l.lineTotalAgorot ?? 0), 0),
    hasUnpricedLines: lines.some((l) => l.lineTotalAgorot === null),
    showPrices: input.showPrices,
    notes: input.notes?.trim() || null,
    extraLines: (input.extraLines ?? []).filter((s) => s.trim() !== ''),
  };
  return doc;
}

/** Run the extensions in order and append their non-empty lines to `doc.extraLines`. */
export async function applyOrderDocumentExtensions(
  doc: OrderDocument,
  extensions: readonly OrderDocumentExtension[],
  ctx: OrderDocumentExtensionContext,
): Promise<OrderDocument> {
  const extraLines = [...doc.extraLines];
  for (const ext of extensions) {
    const lines = await ext(doc, ctx);
    extraLines.push(...lines.filter((s) => s.trim() !== ''));
  }
  return { ...doc, extraLines };
}
