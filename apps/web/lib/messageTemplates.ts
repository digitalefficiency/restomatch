/**
 * WhatsApp / SMS message templates for manager actions.
 *
 * Each builder fills order/invoice context into a Hebrew message string. Pair
 * with waLink() to produce a wa.me deep link that opens the manager's own
 * WhatsApp with the message pre-filled (no Business API needed).
 */

/** Israeli local number → wa.me international (972XXXXXXXXX). */
export function toIntlPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
}

/** Build a click-to-chat WhatsApp link with a pre-filled message. */
export function waLink(phone: string, message: string): string {
  return `https://wa.me/${toIntlPhone(phone)}?text=${encodeURIComponent(message)}`;
}

/** Plain tel: link. */
export function telLink(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`;
}

export interface TemplateLine {
  rawDescription: string;
  qty: number;
  unit?: string;
}

export const messageTemplates = {
  lateDelivery(o: { supplierName: string; agentName?: string; orderedOn?: string; expectedLabel?: string }): string {
    const who = o.agentName ? `שלום ${o.agentName}, ` : 'שלום, ';
    return (
      `${who}ההזמנה מ"${o.supplierName}"` +
      (o.orderedOn ? ` (הוזמנה ${o.orderedOn})` : '') +
      ` שאמורה הייתה להגיע ${o.expectedLabel ?? 'היום'} טרם הגיעה. אשמח לעדכון מתי היא תגיע. תודה.`
    );
  },

  priceDispute(o: {
    supplierName: string;
    productName: string;
    sku?: string | null;
    orderedPrice: number;
    invoicePrice: number;
  }): string {
    const delta = (o.invoicePrice - o.orderedPrice).toFixed(2);
    return (
      `שלום, בחשבונית מ"${o.supplierName}" המחיר של ` +
      `${o.productName}${o.sku ? ` (מק״ט ${o.sku})` : ''} ` +
      `הוא ₪${o.invoicePrice} במקום ₪${o.orderedPrice} שסוכם — פער של ₪${delta} ליחידה. ` +
      `נא לתקן / להוציא תעודת זיכוי. תודה.`
    );
  },

  missingItem(o: { supplierName: string; productName: string; qty: number; unit?: string }): string {
    return (
      `שלום, בהזמנה מ"${o.supplierName}" הפריט ${o.productName} ` +
      `(${o.qty}${o.unit ? ' ' + o.unit : ''}) לא הגיע / חסר. נא להשלים או לעדכן. תודה.`
    );
  },

  agentVerification(o: { supplierName: string; role?: string; name?: string; newPhone: string }): string {
    return (
      `שלום, אנו מעדכנים אצלנו את פרטי הקשר של ${o.supplierName}. ` +
      `האם ${o.name ?? 'הסוכן'}${o.role ? ` (${o.role})` : ''} זמין כעת במספר ${o.newPhone}? ` +
      `תודה על האישור.`
    );
  },

  orderConfirmation(o: { supplierName: string; lines: TemplateLine[] }): string {
    const items = o.lines
      .map((l) => `• ${l.rawDescription} — ${l.qty}${l.unit ? ' ' + l.unit : ''}`)
      .join('\n');
    return `שלום, מבקשים להזמין מ"${o.supplierName}":\n${items}\nנא לאשר קבלה ומועד אספקה. תודה.`;
  },
};
