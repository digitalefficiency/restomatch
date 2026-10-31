import { formatIls } from './money';

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

/**
 * Plain text that leaves the app (WhatsApp, SMS) isolates every value with FSI…PDI
 * (lens-copy-rtl §2.4.4), so a Latin supplier like "Coca-Cola Ltd." cannot scramble
 * the Hebrew sentence around it. Never ASCII quotes around a name (Lab I).
 */
const iso = (v: string | number) => `\u2068${v}\u2069`;
/** ₪ from the one formatter, agora precision (unit prices). */
const ils = (n: number) => iso(formatIls(n, { maximumFractionDigits: 2 }));

/**
 * Supplier-facing texts (W2-13): plural "we" voice, no slash forms, glossary terms
 * (חשבונית זיכוי for the credit note). Signatures are unchanged.
 */
export const messageTemplates = {
  lateDelivery(o: { supplierName: string; agentName?: string; orderedOn?: string; expectedLabel?: string }): string {
    const who = o.agentName ? `שלום ${iso(o.agentName)}, ` : 'שלום, ';
    return (
      `${who}ההזמנה מ-${iso(o.supplierName)}` +
      (o.orderedOn ? ` (הוזמנה ב-${iso(o.orderedOn)})` : '') +
      ` שהייתה אמורה להגיע ${o.expectedLabel ? iso(o.expectedLabel) : 'היום'} עדיין לא הגיעה. נשמח לעדכון מתי תגיע. תודה.`
    );
  },

  priceDispute(o: {
    supplierName: string;
    productName: string;
    sku?: string | null;
    orderedPrice: number;
    invoicePrice: number;
  }): string {
    const delta = Math.round((o.invoicePrice - o.orderedPrice) * 100) / 100;
    return (
      `שלום, בחשבונית מ-${iso(o.supplierName)} המחיר של ` +
      `${iso(o.productName)}${o.sku ? ` (מק״ט ${iso(o.sku)})` : ''} ` +
      `הוא ${ils(o.invoicePrice)} במקום ${ils(o.orderedPrice)} שסוכם, פער של ${ils(delta)} ליחידה. ` +
      `נבקש לתקן את החשבונית או להוציא חשבונית זיכוי. תודה.`
    );
  },

  missingItem(o: { supplierName: string; productName: string; qty: number; unit?: string }): string {
    return (
      `שלום, בהזמנה מ-${iso(o.supplierName)} הפריט ${iso(o.productName)} ` +
      `(${iso(`${o.qty}${o.unit ? ' ' + o.unit : ''}`)}) לא הגיע. נבקש להשלים או לעדכן. תודה.`
    );
  },

  agentVerification(o: { supplierName: string; role?: string; name?: string; newPhone: string }): string {
    return (
      `שלום, אנחנו מעדכנים את פרטי הקשר של ${iso(o.supplierName)}. ` +
      `האם ${o.name ? iso(o.name) : 'הסוכן'}${o.role ? ` (${iso(o.role)})` : ''} זמין עכשיו במספר ${iso(o.newPhone)}? ` +
      `תודה על האישור.`
    );
  },

  orderConfirmation(o: { supplierName: string; lines: TemplateLine[] }): string {
    const items = o.lines
      .map((l) => `• ${iso(l.rawDescription)}: ${iso(`${l.qty}${l.unit ? ' ' + l.unit : ''}`)}`)
      .join('\n');
    return `שלום, נבקש להזמין מ-${iso(o.supplierName)}:\n${items}\nנבקש לאשר את ההזמנה ואת מועד האספקה. תודה.`;
  },
};
