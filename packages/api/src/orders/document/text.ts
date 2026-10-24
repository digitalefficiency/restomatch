import { ilsFromAgorot, qtyText } from './format';
import type { OrderDocument } from './types';

/**
 * Email body (plain text, sent alongside the PDF): one line per item with
 * SKU, quantity, unit price and line total, then the order total. Only a
 * contract price (flag `contracts`, verified on the order date) is called
 * agreed — "מחיר חוזה"; any other price is just the price on the order.
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
    if (l.unitPriceAgorot === null || l.lineTotalAgorot === null) return `${base} (ללא מחיר)`;
    const basis = l.contractPrice ? ' (מחיר חוזה)' : '';
    return `${base} × ${ilsFromAgorot(l.unitPriceAgorot)}${basis} = ${ilsFromAgorot(l.lineTotalAgorot)}`;
  });
  const totals = doc.showPrices
    ? [`סה״כ הזמנה (לפני מע״מ): ${ilsFromAgorot(doc.totalAgorot)}`, doc.hasUnpricedLines ? 'שורות ללא מחיר אינן כלולות בסה״כ.' : '']
    : [];
  const footer = doc.showPrices ? priceFootnote(doc) : [];
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

/** What the prices are: "agreed" only for verified contract lines; otherwise the order's prices. */
export function priceFootnote(doc: OrderDocument): string[] {
  const priced = doc.lines.filter((l) => l.unitPriceAgorot !== null);
  if (priced.length === 0) return [];
  const contract = priced.filter((l) => l.contractPrice).length;
  if (contract === priced.length) return ['המחירים הם מחירי החוזה המוסכמים. חיוב בחשבונית מעבר להם ייבדק.'];
  if (contract > 0) return ['מחירים המסומנים "מחיר חוזה" הם המחירים המוסכמים בחוזה; שאר המחירים הם מחירי ההזמנה.'];
  return ['המחירים הם מחירי ההזמנה.'];
}

/** WhatsApp: compact — one short line per item, the total, extension lines. */
export function renderOrderWhatsappText(doc: OrderDocument): string {
  const head = [`*הזמנה ${doc.orderRef}* — ${doc.restaurantName}`, doc.deliveryDate ? `אספקה: ${doc.deliveryDate}` : ''].filter(Boolean);
  const items = doc.lines.map((l) => {
    const sku = l.sku ? `[${l.sku}] ` : '';
    const base = `${sku}${l.description} ${qtyText(l.qty)} ${l.unit}`;
    if (!doc.showPrices || l.unitPriceAgorot === null || l.lineTotalAgorot === null) return base;
    return `${base} × ${ilsFromAgorot(l.unitPriceAgorot)}${l.contractPrice ? ' (חוזה)' : ''} = ${ilsFromAgorot(l.lineTotalAgorot)}`;
  });
  return [
    ...head,
    ...items,
    ...(doc.showPrices ? [`*סה״כ: ${ilsFromAgorot(doc.totalAgorot)}* (לפני מע״מ)`] : []),
    ...(doc.notes ? [`הערות: ${doc.notes}`] : []),
    ...doc.extraLines,
  ].join('\n');
}
