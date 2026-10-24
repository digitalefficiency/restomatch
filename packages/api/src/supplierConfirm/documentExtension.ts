import type { Database } from '@restomatch/db';
import { confirmationLink } from './service';

/**
 * Order-document extension (S5's `orderPricesOut` document, `ORDER_DOCUMENT_EXTENSIONS`):
 * appends the supplier-confirmation link to the email / WhatsApp / PDF of a
 * SENT order. Structurally matches S5's `OrderDocumentExtension`; registered by
 * pushing it onto that array (one line, at integration).
 *
 *  - mode 'send'    → mints ONE fresh 72h link (placeOrder flips the PO to sent first).
 *  - mode 'preview' → never mints; a static hint instead.
 *  - flag `supplierConfirm` off / order not sent → [] (the document is unchanged).
 * The document is Hebrew-only (supplier-facing), so the lines are Hebrew.
 */
export interface SupplierConfirmDocumentContext {
  db: Database;
  restaurantId: string;
  poId: string;
  userId: string | null;
  mode: 'send' | 'preview';
}

export const SUPPLIER_CONFIRM_DOC_LINE_HE = 'לאישור ההזמנה, סימון חוסרים או הצעת מחיר: {url}';
export const SUPPLIER_CONFIRM_DOC_PREVIEW_HE = 'קישור לאישור ההזמנה יצורף בשליחה (תקף 72 שעות).';

export function supplierAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_URL ?? env.AUTH_URL ?? env.NEXTAUTH_URL ?? 'https://app.restomatch.co.il').replace(/\/+$/, '');
}

export async function supplierConfirmDocumentExtension(
  _doc: unknown,
  ctx: SupplierConfirmDocumentContext,
): Promise<string[]> {
  if (ctx.mode === 'preview') {
    const { isFeatureOn } = await import('../lib/featureGate');
    return (await isFeatureOn(ctx.db, ctx.restaurantId, 'supplierConfirm')) ? [SUPPLIER_CONFIRM_DOC_PREVIEW_HE] : [];
  }
  const link = await confirmationLink(ctx.db, ctx.restaurantId, ctx.poId, {
    baseUrl: supplierAppBaseUrl(),
    userId: ctx.userId,
  });
  return link ? [SUPPLIER_CONFIRM_DOC_LINE_HE.replace('{url}', link.url)] : [];
}
