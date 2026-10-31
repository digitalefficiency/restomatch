import { contractPricesForOrder } from '../../contracts/orderPrices';
import { supplierConfirmDocumentExtension } from '../../supplierConfirm/documentExtension';
import { orderDocumentContractPrices } from './load';
import type { OrderDocumentExtension } from './types';

export * from './types';
export { applyOrderDocumentExtensions, buildOrderDocument, lineTotalAgorot, decimalToScaled, type BuildOrderDocumentInput } from './build';
export { priceFootnote, renderOrderEmailText, renderOrderWhatsappText } from './text';
export { renderOrderPdf } from './pdf';
export { ilsFromAgorot } from './format';
export { visualRtl } from './bidi';
export {
  isContractPrice,
  loadOrderDocument,
  orderDocumentContractPrices,
  orderDocumentSettingsOf,
  orderPdfFilename,
  type LoadedOrderDocument,
} from './load';

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

/**
 * Integration wiring (S5 × S11): the document calls a price "agreed" only when
 * it is the contract price in force on the order date. S11's
 * `contractPricesForOrder` (keys `${productId}|${unit}`) is the resolver. Set at
 * module init here — this barrel is imported by routers/orders.ts, so it runs
 * whenever `@restomatch/api` is loaded (web route handler and worker alike).
 * The loader still gates on flag `contracts`.
 */
orderDocumentContractPrices.resolve = contractPricesForOrder;
