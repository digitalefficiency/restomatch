import type { OrderDocumentExtension } from './types';

export * from './types';
export { buildOrderDocument, lineTotalAgorot, decimalToScaled, type BuildOrderDocumentInput } from './build';
export { renderOrderEmailText, renderOrderWhatsappText } from './text';
export { renderOrderPdf } from './pdf';
export { ilsFromAgorot } from './format';
export { visualRtl } from './bidi';
export { loadOrderDocument, orderDocumentSettingsOf, orderPdfFilename, type LoadedOrderDocument } from './load';

/**
 * Extensions applied to every supplier order document (flag `orderPricesOut`).
 * Add an entry here to append lines after the totals in the email text, the
 * WhatsApp text and the PDF — e.g. S11's supplier-confirmation link. Keep each
 * extension pure; it receives the built document.
 */
export const ORDER_DOCUMENT_EXTENSIONS: OrderDocumentExtension[] = [];
