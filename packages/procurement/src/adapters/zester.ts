/**
 * Zester adapter.
 *
 * VERIFY: pending real API contract validation, like adapters/marketman.ts.
 * Zester (Israeli restaurant procurement) exposes vendors, catalog items and
 * purchase orders; the paths and snake_case shapes below are our contract
 * until the official docs + an API token are provisioned (owner activation
 * steps: docs/client-ready/reports/wave1-integrations.md). Offline, the same
 * normalizers run on fixtures/zester.ts.
 */
import type { NormalizedPurchaseOrder } from '@restomatch/types';
import { HttpClient, type HttpClientOptions } from '../http';
import { ZESTER_FIXTURE } from '../fixtures/zester';
import { FixtureTransport, isFixtureMode, type JsonTransport } from '../transport';
import type { AdapterContext, NormalizedProduct, NormalizedSupplier, ProcurementAdapter } from '../types';

const DEFAULT_BASE_URL = 'https://api.zester.co.il/v1';

// VERIFY: pending real API contract
export interface ZesterOrderItem {
  line_id: string;
  item_id?: string;
  item_name: string;
  quantity: number;
  unit_name: string;
  /** Agorot-free decimal shekels, as the API returns them. */
  price?: number;
}

// VERIFY: pending real API contract
export interface ZesterOrder {
  order_id: string;
  order_number: string;
  vendor_id: string;
  vendor_name: string;
  /** Zester workflow states. */
  state: 'draft' | 'submitted' | 'approved' | 'partially_received' | 'received' | 'canceled';
  delivery_date?: string;
  total?: number;
  items: ZesterOrderItem[];
}

interface Page<T> {
  data: T[];
  next_page?: string | null;
}

const STATUS: Record<ZesterOrder['state'], NormalizedPurchaseOrder['status']> = {
  draft: 'draft',
  submitted: 'sent',
  approved: 'confirmed',
  partially_received: 'partial',
  received: 'closed',
  canceled: 'cancelled',
};

export interface ZesterAdapterConfig {
  baseUrl?: string;
  httpOptions?: Partial<HttpClientOptions>;
}

export class ZesterAdapter implements ProcurementAdapter {
  readonly id = 'zester' as const;
  readonly displayName = 'Zester';

  private readonly baseUrl: string;
  private readonly httpOptions: Partial<HttpClientOptions>;

  constructor(config: ZesterAdapterConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.httpOptions = config.httpOptions ?? {};
  }

  private clientFor(ctx: AdapterContext): JsonTransport {
    if (isFixtureMode(ctx.credentials)) return new FixtureTransport(ZESTER_FIXTURE);
    const token = ctx.credentials.accessToken ?? ctx.credentials.apiKey;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Zester adapter requires credentials.accessToken (or apiKey)');
    }
    return new HttpClient({
      baseUrl: this.baseUrl,
      defaultHeaders: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      ...this.httpOptions,
    });
  }

  private async all<T>(client: JsonTransport, path: string, query: Record<string, string | number | undefined>) {
    const out: T[] = [];
    let page: string | undefined;
    do {
      const res = await client.get<Page<T>>(path, { query: { ...query, page } });
      out.push(...res.data);
      page = res.next_page ?? undefined;
    } while (page);
    return out;
  }

  async listOrders(ctx: AdapterContext, since: Date): Promise<NormalizedPurchaseOrder[]> {
    const orders = await this.all<ZesterOrder>(this.clientFor(ctx), '/purchase-orders', {
      updated_since: since.toISOString(),
      per_page: 100,
    });
    return orders.map(normalizeZesterOrder);
  }

  async listDeliveriesScheduled(ctx: AdapterContext, date: Date): Promise<NormalizedPurchaseOrder[]> {
    const orders = await this.all<ZesterOrder>(this.clientFor(ctx), '/purchase-orders', {
      delivery_date: date.toISOString().slice(0, 10),
      per_page: 100,
    });
    return orders.map(normalizeZesterOrder);
  }

  async getOrder(ctx: AdapterContext, externalId: string): Promise<NormalizedPurchaseOrder> {
    const order = await this.clientFor(ctx).get<ZesterOrder>(`/purchase-orders/${encodeURIComponent(externalId)}`);
    return normalizeZesterOrder(order);
  }

  async listSuppliers(ctx: AdapterContext): Promise<NormalizedSupplier[]> {
    const vendors = await this.all<{ vendor_id: string; name: string; company_number?: string; email?: string }>(
      this.clientFor(ctx),
      '/vendors',
      { per_page: 100 },
    );
    return vendors.map((v) => ({
      externalId: v.vendor_id,
      name: v.name,
      businessId: v.company_number,
      contactEmail: v.email,
    }));
  }

  async listProducts(ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const items = await this.all<{
      item_id: string;
      vendor_id?: string;
      name: string;
      sku?: string;
      unit_name?: string;
      category?: string;
    }>(this.clientFor(ctx), '/items', { per_page: 100 });
    return items.map((i) => ({
      externalId: i.item_id,
      supplierExternalId: i.vendor_id,
      name: i.name,
      sku: i.sku,
      unit: i.unit_name,
      category: i.category,
    }));
  }
}

export function normalizeZesterOrder(order: ZesterOrder): NormalizedPurchaseOrder {
  return {
    externalId: order.order_id,
    platform: 'zester',
    supplierExternalId: order.vendor_id,
    supplierName: order.vendor_name,
    expectedDeliveryAt: order.delivery_date,
    status: STATUS[order.state] ?? 'sent',
    currency: 'ILS',
    lines: order.items.map((i) => ({
      externalId: i.line_id,
      productHint: i.item_id,
      rawDescription: i.item_name,
      qty: i.quantity,
      unit: i.unit_name,
      unitPrice: i.price,
    })),
    totalEstimated: order.total,
    metadata: { orderNumber: order.order_number },
  };
}
