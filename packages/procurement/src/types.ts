import type { NormalizedPurchaseOrder } from '@restomatch/types';

export type PlatformId =
  | 'marketman'
  | 'zester'
  | 'zestt'
  | 'tabit'
  | 'yarpa'
  | 'nash'
  | 'restigo'
  | 'restomatch';

/**
 * A source of PO data that arrives as a document (PDF/image) rather than an API
 * feed — e.g. a Zestt order export. Structurally satisfied by the OCR package's
 * Claude PO parser; kept here so procurement does not hard-depend on its types.
 */
export interface PoDocumentParser {
  parse(image: unknown): Promise<NormalizedPurchaseOrder>;
}

export interface NormalizedSupplier {
  externalId: string;
  name: string;
  businessId?: string;
  contactEmail?: string;
}

export interface NormalizedProduct {
  externalId: string;
  supplierExternalId?: string;
  name: string;
  sku?: string;
  unit?: string;
  category?: string;
}

export interface AdapterCredentials {
  apiKey?: string;
  refreshToken?: string;
  accessToken?: string;
  [key: string]: unknown;
}

export interface AdapterContext {
  restaurantId: string;
  credentials: AdapterCredentials;
}

export interface ProcurementAdapter {
  readonly id: PlatformId;
  readonly displayName: string;

  listOrders(ctx: AdapterContext, since: Date): Promise<NormalizedPurchaseOrder[]>;
  listDeliveriesScheduled(ctx: AdapterContext, date: Date): Promise<NormalizedPurchaseOrder[]>;
  getOrder(ctx: AdapterContext, externalId: string): Promise<NormalizedPurchaseOrder>;
  listSuppliers(ctx: AdapterContext): Promise<NormalizedSupplier[]>;
  listProducts(ctx: AdapterContext): Promise<NormalizedProduct[]>;

  handleWebhook?(ctx: AdapterContext, payload: unknown): Promise<NormalizedPurchaseOrder[]>;

  /**
   * Parse an uploaded order document (PDF/image) into a normalized PO. Optional:
   * only document-sourced platforms (e.g. Zestt PDF export) implement it; API
   * platforms omit it. `image` is an OCR ImageSource (Buffer | URL | base64).
   */
  parseDocument?(ctx: AdapterContext, image: unknown): Promise<NormalizedPurchaseOrder>;
}
