/**
 * Market Man adapter.
 *
 * VERIFY: pending real API contract validation. Endpoints and response
 * shapes below are designed against the typical patterns of restaurant
 * procurement APIs. Replace path/header/payload details before sending
 * the first real request once the official Market Man docs / API key are
 * provisioned (BUILD-PROMPT §M5 narrowing).
 */

import type { NormalizedPurchaseOrder } from '@restomatch/types';
import { HttpClient, type HttpClientOptions } from '../http';
import type {
  AdapterContext,
  NormalizedProduct,
  NormalizedSupplier,
  ProcurementAdapter,
} from '../types';

const DEFAULT_BASE_URL = 'https://api.marketman.com/v3';

// VERIFY: pending real API contract
export interface MarketManOrderLine {
  id: string;
  productId?: string;
  productName?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice?: number;
}

// VERIFY: pending real API contract
export interface MarketManOrder {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: 'draft' | 'sent' | 'confirmed' | 'partial' | 'closed' | 'cancelled';
  expectedDeliveryAt?: string;
  currency?: 'ILS' | 'USD' | 'EUR';
  totalEstimated?: number;
  lines: MarketManOrderLine[];
  metadata?: Record<string, unknown>;
}

interface ListOrdersResponse {
  orders: MarketManOrder[];
  nextCursor?: string;
}

interface ListSuppliersResponse {
  suppliers: Array<{
    id: string;
    name: string;
    businessId?: string;
    contactEmail?: string;
  }>;
}

interface ListProductsResponse {
  products: Array<{
    id: string;
    supplierId?: string;
    name: string;
    sku?: string;
    unit?: string;
    category?: string;
  }>;
}

export interface MarketManAdapterConfig {
  baseUrl?: string;
  httpOptions?: Partial<HttpClientOptions>;
}

export class MarketManAdapter implements ProcurementAdapter {
  readonly id = 'marketman' as const;
  readonly displayName = 'Market Man';

  private readonly baseUrl: string;
  private readonly httpOptions: Partial<HttpClientOptions>;

  constructor(config: MarketManAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.httpOptions = config.httpOptions ?? {};
  }

  private clientFor(ctx: AdapterContext): HttpClient {
    const apiKey = ctx.credentials.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error('MarketMan adapter requires credentials.apiKey');
    }
    return new HttpClient({
      baseUrl: this.baseUrl,
      defaultHeaders: { 'X-API-Key': apiKey, Accept: 'application/json' },
      ...this.httpOptions,
    });
  }

  async listOrders(ctx: AdapterContext, since: Date): Promise<NormalizedPurchaseOrder[]> {
    const client = this.clientFor(ctx);
    const all: MarketManOrder[] = [];
    let cursor: string | undefined;
    do {
      const res = await client.get<ListOrdersResponse>('/orders', {
        query: { since: since.toISOString(), limit: 100, cursor },
      });
      all.push(...res.orders);
      cursor = res.nextCursor;
    } while (cursor);
    return all.map(normalizeOrder);
  }

  async listDeliveriesScheduled(
    ctx: AdapterContext,
    date: Date,
  ): Promise<NormalizedPurchaseOrder[]> {
    const client = this.clientFor(ctx);
    const yyyy = date.toISOString().slice(0, 10);
    const res = await client.get<ListOrdersResponse>('/orders/deliveries', {
      query: { date: yyyy },
    });
    return res.orders.map(normalizeOrder);
  }

  async getOrder(ctx: AdapterContext, externalId: string): Promise<NormalizedPurchaseOrder> {
    const client = this.clientFor(ctx);
    const order = await client.get<MarketManOrder>(`/orders/${encodeURIComponent(externalId)}`);
    return normalizeOrder(order);
  }

  async listSuppliers(ctx: AdapterContext): Promise<NormalizedSupplier[]> {
    const client = this.clientFor(ctx);
    const res = await client.get<ListSuppliersResponse>('/suppliers');
    return res.suppliers.map((s) => ({
      externalId: s.id,
      name: s.name,
      businessId: s.businessId,
      contactEmail: s.contactEmail,
    }));
  }

  async listProducts(ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const client = this.clientFor(ctx);
    const res = await client.get<ListProductsResponse>('/products');
    return res.products.map((p) => ({
      externalId: p.id,
      supplierExternalId: p.supplierId,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      category: p.category,
    }));
  }
}

function normalizeOrder(order: MarketManOrder): NormalizedPurchaseOrder {
  return {
    externalId: order.id,
    platform: 'marketman',
    supplierExternalId: order.supplierId,
    supplierName: order.supplierName,
    expectedDeliveryAt: order.expectedDeliveryAt,
    status: order.status,
    currency: order.currency ?? 'ILS',
    lines: order.lines.map((l) => ({
      externalId: l.id,
      productHint: l.productId,
      rawDescription: l.description || l.productName || '',
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
    })),
    totalEstimated: order.totalEstimated,
    metadata: order.metadata,
  };
}
