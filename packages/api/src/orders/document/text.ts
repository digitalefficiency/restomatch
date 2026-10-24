import { ilsFromAgorot, qtyText } from './format';
import type { OrderDocument } from './types';

/**
 * Email body (plain text, sent alongside the PDF): one line per item with
 * SKU, quantity, agreed unit price and line total, then the order total.
 */
export function renderOrderEmailText(doc: OrderDocument): string {
  const head = [
    `הזמנה לספק ${doc.supplierName}`,
    `מאת: ${doc.restaurantName}`,
    `מס׳ הזמנה: ${doc.orderRef} · תאריך: ${doc.orderDate}`,
    doc.deliveryDate ? `אספקה מבוקשת: ${doc.deliveryDate}` : '',
  ].filter(Boolean);
  const items = doc.lines.map((l) => {
    const sku = l.sku ? `מק״ט ${l.sku} · ` : '';
    const base = `• ${sku}${l.description} — ${qtyText(l.qty)} ${l.unit}`;
    if (!doc.showPrices) return base;
    if (l.unitPriceAgorot === null || l.lineTotalAgorot === null) return `${base} (ללא מחיר מוסכם)`;
    return `${base} × ${ilsFromAgorot(l.unitPriceAgorot)} = ${ilsFromAgorot(l.lineTotalAgorot)}`;
  });
  const totals = doc.showPrices
    ? [`סה״כ הזמנה (לפני מע״מ): ${ilsFromAgorot(doc.totalAgorot)}`, doc.hasUnpricedLines ? 'שורות ללא מחיר מוסכם אינן כלולות בסה״כ.' : '']
    : [];
  const footer = doc.showPrices ? ['המחירים הם המחירים המוסכמים. חיוב בחשבונית מעבר להם ייבדק.'] : [];
  return [
    ...head,
    '',
    ...items,
    '',
    ...totals.filter(Boolean),
    ...(doc.notes ? [`הערות: ${doc.notes}`] : []),
    ...footer,
    ...doc.extraLines,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** WhatsApp: compact — one short line per item, the total, extension lines. */
export function renderOrderWhatsappText(doc: OrderDocument): string {
  const head = [`*הזמנה ${doc.orderRef}* — ${doc.restaurantName}`, doc.deliveryDate ? `אספקה: ${doc.deliveryDate}` : ''].filter(Boolean);
  const items = doc.lines.map((l) => {
    const sku = l.sku ? `[${l.sku}] ` : '';
    const base = `${sku}${l.description} ${qtyText(l.qty)} ${l.unit}`;
    if (!doc.showPrices || l.unitPriceAgorot === null || l.lineTotalAgorot === null) return base;
    return `${base} × ${ilsFromAgorot(l.unitPriceAgorot)} = ${ilsFromAgorot(l.lineTotalAgorot)}`;
  });
  return [
    ...head,
    ...items,
    ...(doc.showPrices ? [`*סה״כ: ${ilsFromAgorot(doc.totalAgorot)}* (לפני מע״מ)`] : []),
    ...(doc.notes ? [`הערות: ${doc.notes}`] : []),
    ...doc.extraLines,
  ].join('\n');
}
