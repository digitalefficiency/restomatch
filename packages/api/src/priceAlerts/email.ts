import { buildOwnerDigest } from './digest';
import type { MailLocale } from './money';

/**
 * One price alert as a mail — kept exported (`index.ts`) for callers that show a
 * single alert. Since AU-13 it is the morning digest with ONE line: the same
 * LIGHT template, the same copy, the same ₪ (`priceAlerts/money.ts`, the server
 * twin of the web's `formatIls`, 2 decimals for unit prices). The 07:00 sweep
 * itself sends `buildOwnerDigest` with every open alert, one mail per person.
 */
export interface PriceAlertEmail {
  subject: string;
  html: string;
  text: string;
}

export function priceAlertEmail(args: {
  productName: string;
  supplierName: string;
  pctChange: number;
  windowDays: number;
  startPrice: number;
  endPrice: number;
  cheaperSupplierName: string | null;
  cheaperPrice: number | null;
  url?: string;
  /** ≈₪/month (W2-12 impact), integer agorot; omitted = not enough data. */
  monthlyAgorot?: number | null;
  locale?: MailLocale;
}): PriceAlertEmail {
  const mail = buildOwnerDigest({
    locale: args.locale ?? 'he',
    creep: [
      {
        alertId: 'single',
        productName: args.productName,
        supplierName: args.supplierName,
        pctChange: args.pctChange,
        windowDays: args.windowDays,
        startPrice: args.startPrice,
        endPrice: args.endPrice,
        cheaperSupplierName: args.cheaperSupplierName,
        cheaperPrice: args.cheaperPrice,
        monthlyAgorot: args.monthlyAgorot ?? null,
        tone: 't4',
      },
    ],
    contracts: [],
    dishes: [],
    listDiffs: [],
    links: { queue: args.url },
  })!;
  return { subject: mail.subject, html: mail.html, text: mail.text };
}
