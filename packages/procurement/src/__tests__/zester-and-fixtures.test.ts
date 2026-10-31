import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ZesterAdapter } from '../adapters/zester';
import { MarketManAdapter } from '../adapters/marketman';
import { getAdapter, listSupportedPlatforms } from '../registry';
import { FixtureTransport } from '../transport';
import type { AdapterContext } from '../types';

const BASE = 'https://api.zester.test/v1';
// Any request that reaches the network in fixture mode fails the test.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const live: AdapterContext = { restaurantId: 'r1', credentials: { accessToken: 'zs-token' } };
const fixture: AdapterContext = { restaurantId: 'r1', credentials: { mode: 'fixture' } };

function zester() {
  return new ZesterAdapter({ baseUrl: BASE, httpOptions: { maxRetries: 1, retryBaseDelayMs: 1, timeoutMs: 2000 } });
}

describe('ZesterAdapter over HTTP', () => {
  it('sends the bearer token, follows pagination and normalizes snake_case orders', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${BASE}/purchase-orders`, ({ request }) => {
        expect(request.headers.get('Authorization')).toBe('Bearer zs-token');
        const url = new URL(request.url);
        seen.push(url.searchParams.get('page') ?? '1');
        expect(url.searchParams.get('updated_since')).toBe('2026-10-01T00:00:00.000Z');
        if (url.searchParams.get('page') === '2') {
          return HttpResponse.json({
            data: [
              { order_id: 'o2', order_number: 'Z-2', vendor_id: 'v1', vendor_name: 'ספק', state: 'received', items: [] },
            ],
            next_page: null,
          });
        }
        return HttpResponse.json({
          data: [
            {
              order_id: 'o1',
              order_number: 'Z-1',
              vendor_id: 'v1',
              vendor_name: 'ספק',
              state: 'approved',
              delivery_date: '2026-10-19',
              total: 30,
              items: [{ line_id: 'l1', item_id: 'i1', item_name: 'בצל', quantity: 10, unit_name: 'ק״ג', price: 3 }],
            },
          ],
          next_page: '2',
        });
      }),
    );
    const orders = await zester().listOrders(live, new Date('2026-10-01T00:00:00Z'));
    expect(seen).toEqual(['1', '2']);
    expect(orders.map((o) => [o.externalId, o.status, o.platform])).toEqual([
      ['o1', 'confirmed', 'zester'],
      ['o2', 'closed', 'zester'],
    ]);
    expect(orders[0]!.lines[0]).toMatchObject({ rawDescription: 'בצל', qty: 10, unit: 'ק״ג', unitPrice: 3 });
  });

  it('requires a token for a live account', async () => {
    await expect(zester().listSuppliers({ restaurantId: 'r1', credentials: {} })).rejects.toThrow(/accessToken/);
  });

  it('surfaces a server error after retries', async () => {
    server.use(http.get(`${BASE}/vendors`, () => new HttpResponse(null, { status: 503 })));
    await expect(zester().listSuppliers(live)).rejects.toThrow();
  });
});

describe('fixture mode (offline provider: demo tenant, no credentials, no network)', () => {
  it('Zester: suppliers, products, paginated orders, deliveries and getOrder', async () => {
    const a = zester();
    expect((await a.listSuppliers(fixture)).map((s) => s.name)).toEqual(['קצביית הכרם', 'תבליני פרשמן']);
    expect(await a.listProducts(fixture)).toHaveLength(3);
    const orders = await a.listOrders(fixture, new Date(0));
    expect(orders.map((o) => o.externalId)).toEqual(['zs-o-501', 'zs-o-502']);
    const due = await a.listDeliveriesScheduled(fixture, new Date('2026-10-21T08:00:00Z'));
    expect(due.map((o) => o.externalId)).toEqual(['zs-o-502']);
    expect((await a.getOrder(fixture, 'zs-o-501')).lines).toHaveLength(2);
  });

  it('MarketMan: the same normalizer runs on the recorded fixture', async () => {
    const a = new MarketManAdapter({ baseUrl: 'https://api.marketman.test/v3' });
    const orders = await a.listOrders(fixture, new Date(0));
    expect(orders.map((o) => o.externalId)).toEqual(['mm-ord-1001', 'mm-ord-1002']);
    expect(orders[0]).toMatchObject({ platform: 'marketman', supplierName: 'ירקות השרון', currency: 'ILS' });
    const due = await a.listDeliveriesScheduled(fixture, new Date('2026-10-19T09:00:00Z'));
    expect(due.map((o) => o.externalId)).toEqual(['mm-ord-1001']);
    expect((await a.getOrder(fixture, 'mm-ord-1002')).lines[0]!.unitPrice).toBe(15.5);
  });

  it('a fixture never leaks mutations between calls; unknown paths reject', async () => {
    const t = new FixtureTransport({ '/x': { list: [1] } });
    const first = await t.get<{ list: number[] }>('/x');
    first.list.push(2);
    expect((await t.get<{ list: number[] }>('/x')).list).toEqual([1]);
    await expect(t.get('/nope')).rejects.toThrow(/no response/);
  });

  it('the registry serves both API platforms', () => {
    expect(listSupportedPlatforms().sort()).toEqual(['marketman', 'zester']);
    expect(getAdapter('zester').displayName).toBe('Zester');
  });
});
