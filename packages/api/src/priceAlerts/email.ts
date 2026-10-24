import { formatIlsAgorot } from '../reports/money';

/**
 * Price-trend alert email (Hebrew, RTL). Self-contained so the shared
 * notification templates (owned by the auth/emails area) stay untouched.
 * ₪ goes through formatIlsAgorot (the server twin of the web's formatIls, pinned
 * by money-parity.test.ts) with 2 decimals — the same "‏6.20 ‏₪" the in-app
 * price-alerts panel prints for the same alert.
 */
export interface PriceAlertEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Unit prices arrive in shekels (NUMERIC-derived); agorot at the boundary, format at display. */
const ils = (n: number): string => formatIlsAgorot(Math.round(n * 100), { maximumFractionDigits: 2 });

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
}): PriceAlertEmail {
  const pct = `+${Math.round(args.pctChange * 100)}%`;
  const weeks = Math.max(1, Math.round(args.windowDays / 7));
  const subject = `📈 ${args.productName} ${pct} ב-${weeks} שבועות — ${args.supplierName}`;
  const cheaper =
    args.cheaperSupplierName && args.cheaperPrice != null
      ? `אותו מוצר אצל ${args.cheaperSupplierName}: ${ils(args.cheaperPrice)} ליחידה.`
      : '';
  const text =
    `התראת מחיר — ${args.productName} (${args.supplierName})\n\n` +
    `המחיר עלה ${pct} במהלך ${weeks} שבועות: מ-${ils(args.startPrice)} ל-${ils(args.endPrice)} ליחידה.` +
    (cheaper ? `\n${cheaper}` : '') +
    (args.url ? `\n\nלפרטים: ${args.url}` : '');
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="font-family:Arial,sans-serif;background:#0b1220;color:#e5e7eb;padding:24px">
<div style="max-width:560px;margin:auto;background:#111827;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(args.productName)} <span style="color:#f87171">${esc(pct)}</span></h1>
<p style="margin:0 0 8px">${esc(args.supplierName)} — עלייה מתמשכת ב-${weeks} שבועות: מ-${esc(ils(args.startPrice))} ל-<strong>${esc(ils(args.endPrice))}</strong> ליחידה.</p>
${cheaper ? `<p style="margin:0 0 8px;color:#34d399">${esc(cheaper)}</p>` : ''}
${args.url ? `<p style="margin:16px 0 0"><a href="${esc(args.url)}" style="color:#60a5fa">צפייה בהתראות המחיר</a></p>` : ''}
</div></body></html>`;
  return { subject, html, text };
}
