import { formatIls } from '@/lib/money';

export interface RequestInvoice {
  invoiceNumber: string | null;
  /** YYYY-MM-DD */
  invoiceDate: string;
  totalExclVat: number;
}

const heDay = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * The message the owner copies to a supplier asking for corrected tax invoices
 * with an allocation number (flag vatAtRisk). Always Hebrew — it goes to an
 * Israeli supplier whatever language the owner's screen is in — so it is built
 * here, not from the he/en message catalogue. Nothing is sent by the system.
 */
export function supplierRequestText(args: {
  supplierName: string;
  restaurantName: string;
  invoices: RequestInvoice[];
}): string {
  const lines = args.invoices.map(
    (i) =>
      `• חשבונית ${i.invoiceNumber ? `מס׳ ${i.invoiceNumber}` : 'ללא מספר'} מיום ${heDay(i.invoiceDate)} — ${formatIls(i.totalExclVat, { maximumFractionDigits: 2, locale: 'he' })} לפני מע״מ`,
  );
  const one = args.invoices.length === 1;
  return [
    `שלום ${args.supplierName},`,
    '',
    one
      ? 'החשבונית הבאה התקבלה אצלנו ללא מספר הקצאה תקין:'
      : 'החשבוניות הבאות התקבלו אצלנו ללא מספר הקצאה תקין:',
    ...lines,
    '',
    `לפי רפורמת חשבוניות ישראל לא נוכל לקזז את המע״מ ${one ? 'שלה' : 'שלהן'} בלי מספר הקצאה מרשות המסים. נבקש להפיק ${one ? 'חשבונית מתוקנת' : 'חשבוניות מתוקנות'} עם מספר הקצאה.`,
    '',
    'תודה,',
    args.restaurantName,
  ].join('\n');
}
