import { supplierConfirmDocumentExtension } from '../../supplierConfirm/documentExtension';
import type { OrderDocumentExtension } from './types';

export * from './types';
export { applyOrderDocumentExtensions, buildOrderDocument, lineTotalAgorot, decimalToScaled, type BuildOrderDocumentInput } from './build';
export { renderOrderEmailText, renderOrderWhatsappText } from './text';
export { renderOrderPdf } from './pdf';
export { ilsFromAgorot } from './format';
export { visualRtl } from './bidi';
export { loadOrderDocument, orderDocumentSettingsOf, orderPdfFilename, type LoadedOrderDocument } from './load';

/**
 * Extensions applied to every supplier order document (flag `orderPricesOut`).
 * Add an entry here to append lines after the totals in the email text, the
 * WhatsApp text and the PDF. Each receives the built document and an
 * `OrderDocumentExtensionContext`; side effects (minting a link) belong only in
 * mode 'send'.
 *
 *  - S11 supplier confirmation (flag `supplierConfirm`): 'send' mints one 72h
 *    link and appends it; 'preview' shows a static hint, never a link.
 */
export const ORDER_DOCUMENT_EXTENSIONS: OrderDocumentExtension[] = [supplierConfirmDocumentExtension];
