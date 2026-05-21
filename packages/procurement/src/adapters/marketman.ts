import type {
  AdapterContext,
  NormalizedProduct,
  NormalizedSupplier,
  ProcurementAdapter,
} from '../types.js';
import type { NormalizedPurchaseOrder } from '@restomatch/types';

export class MarketManAdapter implements ProcurementAdapter {
  readonly id = 'marketman' as const;
  readonly displayName = 'Market Man';

  async listOrders(_ctx: AdapterContext, _since: Date): Promise<NormalizedPurchaseOrder[]> {
    throw new Error('MarketMan.listOrders not yet implemented — see docs/integrations/marketman.md');
  }

  async listDeliveriesScheduled(
    _ctx: AdapterContext,
    _date: Date,
  ): Promise<NormalizedPurchaseOrder[]> {
    throw new Error('MarketMan.listDeliveriesScheduled not yet implemented');
  }

  async getOrder(_ctx: AdapterContext, _externalId: string): Promise<NormalizedPurchaseOrder> {
    throw new Error('MarketMan.getOrder not yet implemented');
  }

  async listSuppliers(_ctx: AdapterContext): Promise<NormalizedSupplier[]> {
    throw new Error('MarketMan.listSuppliers not yet implemented');
  }

  async listProducts(_ctx: AdapterContext): Promise<NormalizedProduct[]> {
    throw new Error('MarketMan.listProducts not yet implemented');
  }
}
