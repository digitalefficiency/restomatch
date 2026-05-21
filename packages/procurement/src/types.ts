import type { NormalizedPurchaseOrder } from '@restomatch/types';

export type PlatformId =
  | 'marketman'
  | 'zester'
  | 'tabit'
  | 'yarpa'
  | 'nash'
  | 'restigo'
  | 'restomatch';

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
}
