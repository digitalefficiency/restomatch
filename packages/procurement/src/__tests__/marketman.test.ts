import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MarketManAdapter } from '../adapters/marketman';
import { HttpError } from '../http';
import type { AdapterContext } from '../types';

const BASE_URL = 'https://api.marketman.test/v3';

const ctx: AdapterContext = {
  restaurantId: 'rest-1',
  credentials: { apiKey: 'test-api-key' },
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeAdapter() {
  return new MarketManAdapter({
    baseUrl: BASE_URL,
    httpOptions: { maxRetries: 2, retryBaseDelayMs: 1, timeoutMs: 2000 },
  });
}

describe('MarketManAdapter.listOrders', () => {
  it('returns normalized orders on happy path', async () => {
    server.use(
      http.get(`${BASE_URL}/orders`, ({ request }) => {
        expect(request.headers.get('X-API-Key')).toBe('test-api-key');
        return HttpResponse.json({
          orders: [
            {
              id: 'ord-1',
              number: 'PO-001',
              supplierId: 'sup-1',
              supplierName: 'ירקני אבי',
              status: 'sent',
              expectedDeliveryAt: '2026-05-22T08:00:00Z',
              currency: 'ILS',
              totalEstimated: 100,
              lines: [
                {
                  id: 'ln-1',
                  productId: 'p-1',
                  description: 'עגבניה שרי',
                  qty: 10,
                  unit: 'ק״ג',
                  unitPrice: 8,
                },
              ],
            },
          ],
        });
      }),
    );

    const adapter = makeAdapter();
    const orders = await adapter.listOrders(ctx, new Date('2026-05-01'));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      externalId: 'ord-1',
      platform: 'marketman',
      supplierExternalId: 'sup-1',
      supplierName: 'ירקני אבי',
      status: 'sent',
      currency: 'ILS',
    });
    expect(orders[0]?.lines[0]).toMatchObject({
      externalId: 'ln-1',
      productHint: 'p-1',
      rawDescription: 'עגבניה שרי',
      qty: 10,
      unit: 'ק״ג',
      unitPrice: 8,
    });
  });

  it('paginates via nextCursor', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE_URL}/orders`, ({ request }) => {
        calls += 1;
        const url = new URL(request.url);
        const cursor = url.searchParams.get('cursor');
        if (!cursor) {
          return HttpResponse.json({
            orders: [makeOrder('ord-1')],
            nextCursor: 'page2',
          });
        }
        return HttpResponse.json({ orders: [makeOrder('ord-2')] });
      }),
    );
    const adapter = makeAdapter();
    const orders = await adapter.listOrders(ctx, new Date('2026-05-01'));
    expect(calls).toBe(2);
    expect(orders.map((o) => o.externalId)).toEqual(['ord-1', 'ord-2']);
  });

  it('returns empty array when API returns no orders', async () => {
    server.use(http.get(`${BASE_URL}/orders`, () => HttpResponse.json({ orders: [] })));
    const adapter = makeAdapter();
    expect(await adapter.listOrders(ctx, new Date())).toEqual([]);
  });

  it('retries on 500 then succeeds', async () => {
    let attempt = 0;
    server.use(
      http.get(`${BASE_URL}/orders`, () => {
        attempt += 1;
        if (attempt < 2) {
          return new HttpResponse('upstream', { status: 500 });
        }
        return HttpResponse.json({ orders: [makeOrder('ord-1')] });
      }),
    );
    const adapter = makeAdapter();
    const orders = await adapter.listOrders(ctx, new Date());
    expect(orders).toHaveLength(1);
    expect(attempt).toBe(2);
  });

  it('retries on 429 rate limit', async () => {
    let attempt = 0;
    server.use(
      http.get(`${BASE_URL}/orders`, () => {
        attempt += 1;
        if (attempt < 2) {
          return new HttpResponse('rate-limited', { status: 429 });
        }
        return HttpResponse.json({ orders: [makeOrder('ord-1')] });
      }),
    );
    const adapter = makeAdapter();
    const orders = await adapter.listOrders(ctx, new Date());
    expect(orders).toHaveLength(1);
    expect(attempt).toBe(2);
  });

  it('does NOT retry on 401 unauthorized', async () => {
    let attempt = 0;
    server.use(
      http.get(`${BASE_URL}/orders`, () => {
        attempt += 1;
        return new HttpResponse('unauthorized', { status: 401 });
      }),
    );
    const adapter = makeAdapter();
    await expect(adapter.listOrders(ctx, new Date())).rejects.toBeInstanceOf(HttpError);
    expect(attempt).toBe(1);
  });

  it('does NOT retry on 400 bad request', async () => {
    let attempt = 0;
    server.use(
      http.get(`${BASE_URL}/orders`, () => {
        attempt += 1;
        return new HttpResponse('bad params', { status: 400 });
      }),
    );
    const adapter = makeAdapter();
    await expect(adapter.listOrders(ctx, new Date())).rejects.toBeInstanceOf(HttpError);
    expect(attempt).toBe(1);
  });

  it('eventually fails after exhausting retries on persistent 500', async () => {
    let attempt = 0;
    server.use(
      http.get(`${BASE_URL}/orders`, () => {
        attempt += 1;
        return new HttpResponse('upstream', { status: 500 });
      }),
    );
    const adapter = makeAdapter();
    await expect(adapter.listOrders(ctx, new Date())).rejects.toBeInstanceOf(HttpError);
    expect(attempt).toBe(3); // 1 initial + 2 retries
  });

  it('defaults currency to ILS when omitted', async () => {
    server.use(
      http.get(`${BASE_URL}/orders`, () =>
        HttpResponse.json({ orders: [makeOrder('ord-1', { currency: undefined })] }),
      ),
    );
    const adapter = makeAdapter();
    const orders = await adapter.listOrders(ctx, new Date());
    expect(orders[0]?.currency).toBe('ILS');
  });
});

describe('MarketManAdapter.getOrder', () => {
  it('returns a single normalized order', async () => {
    server.use(
      http.get(`${BASE_URL}/orders/ord-7`, () => HttpResponse.json(makeOrder('ord-7'))),
    );
    const adapter = makeAdapter();
    const order = await adapter.getOrder(ctx, 'ord-7');
    expect(order.externalId).toBe('ord-7');
  });

  it('URL-encodes externalId with special characters', async () => {
    let capturedPath = '';
    server.use(
      http.get(`${BASE_URL}/orders/:id`, ({ params, request }) => {
        capturedPath = new URL(request.url).pathname;
        return HttpResponse.json(makeOrder(String(params.id)));
      }),
    );
    const adapter = makeAdapter();
    await adapter.getOrder(ctx, 'ord/with#special');
    expect(capturedPath).toContain('ord%2Fwith%23special');
  });
});

describe('MarketManAdapter.listSuppliers', () => {
  it('returns normalized suppliers', async () => {
    server.use(
      http.get(`${BASE_URL}/suppliers`, () =>
        HttpResponse.json({
          suppliers: [
            { id: 's-1', name: 'ירקני אבי', businessId: '301234561' },
            { id: 's-2', name: 'קצביית הכרם', contactEmail: 'sales@katsav.test' },
          ],
        }),
      ),
    );
    const adapter = makeAdapter();
    const suppliers = await adapter.listSuppliers(ctx);
    expect(suppliers).toHaveLength(2);
    expect(suppliers[0]).toMatchObject({
      externalId: 's-1',
      name: 'ירקני אבי',
      businessId: '301234561',
    });
    expect(suppliers[1]?.contactEmail).toBe('sales@katsav.test');
  });
});

describe('MarketManAdapter.listProducts', () => {
  it('returns normalized products', async () => {
    server.use(
      http.get(`${BASE_URL}/products`, () =>
        HttpResponse.json({
          products: [
            {
              id: 'p-1',
              supplierId: 's-1',
              name: 'עגבניה שרי',
              sku: 'TOM-001',
              unit: 'ק״ג',
              category: 'ירקות',
            },
          ],
        }),
      ),
    );
    const adapter = makeAdapter();
    const products = await adapter.listProducts(ctx);
    expect(products[0]).toMatchObject({
      externalId: 'p-1',
      supplierExternalId: 's-1',
      name: 'עגבניה שרי',
      sku: 'TOM-001',
      unit: 'ק״ג',
      category: 'ירקות',
    });
  });
});

describe('MarketManAdapter.listDeliveriesScheduled', () => {
  it('passes ISO date and returns normalized orders', async () => {
    server.use(
      http.get(`${BASE_URL}/orders/deliveries`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('date')).toBe('2026-05-22');
        return HttpResponse.json({ orders: [makeOrder('ord-1')] });
      }),
    );
    const adapter = makeAdapter();
    const orders = await adapter.listDeliveriesScheduled(ctx, new Date('2026-05-22T08:00:00Z'));
    expect(orders).toHaveLength(1);
  });
});

describe('MarketManAdapter auth', () => {
  it('throws when apiKey is missing', async () => {
    const adapter = makeAdapter();
    const badCtx: AdapterContext = { restaurantId: 'r', credentials: {} };
    await expect(adapter.listOrders(badCtx, new Date())).rejects.toThrow(/apiKey/);
  });

  it('throws when apiKey is empty string', async () => {
    const adapter = makeAdapter();
    const badCtx: AdapterContext = { restaurantId: 'r', credentials: { apiKey: '' } };
    await expect(adapter.listSuppliers(badCtx)).rejects.toThrow(/apiKey/);
  });
});

describe('MarketManAdapter line normalization', () => {
  it('falls back to productName when description is empty', async () => {
    server.use(
      http.get(`${BASE_URL}/orders`, () =>
        HttpResponse.json({
          orders: [
            {
              id: 'ord-1',
              number: 'PO-001',
              supplierId: 's',
              supplierName: 'X',
              status: 'sent',
              lines: [
                { id: 'ln-1', description: '', productName: 'Tomato', qty: 1, unit: 'kg' },
              ],
            },
          ],
        }),
      ),
    );
    const adapter = makeAdapter();
    const orders = await adapter.listOrders(ctx, new Date());
    expect(orders[0]?.lines[0]?.rawDescription).toBe('Tomato');
  });
});

function makeOrder(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    number: id,
    supplierId: 's-1',
    supplierName: 'ירקני אבי',
    status: 'sent' as const,
    expectedDeliveryAt: '2026-05-22T08:00:00Z',
    currency: 'ILS' as const,
    totalEstimated: 100,
    lines: [
      { id: 'ln-1', description: 'item', qty: 1, unit: 'ק״ג', unitPrice: 10 },
    ],
    ...overrides,
  };
}
