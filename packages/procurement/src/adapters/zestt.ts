import type { NormalizedPurchaseOrder } from '@restomatch/types';
import type {
  AdapterContext,
  NormalizedProduct,
  NormalizedSupplier,
  PlatformId,
  PoDocumentParser,
  ProcurementAdapter,
} from '../types';

const DOCUMENT_ONLY =
  'Zestt is a document-import platform — use parseDocument(); there is no API feed yet.';

/**
 * Zestt adapter. Zestt has no API integration today: orders arrive as PDF
 * exports, so this adapter is DOCUMENT-ONLY — `parseDocument` delegates to an
 * injected {@link PoDocumentParser} (Claude in prod, a stub in tests) and stamps
 * the canonical `zestt` platform. The API-feed methods throw until/if Zestt
 * exposes one. The import-time totals checksup lives in the API import
 * orchestrator, which also owns supplier/SKU resolution and the idempotent upsert.
 */
export class ZesttAdapter implements ProcurementAdapter {
  readonly id: PlatformId = 'zestt';
  readonly displayName = 'Zestt';

  constructor(private readonly parser: PoDocumentParser) {}

  async parseDocument(_ctx: AdapterContext, image: unknown): Promise<NormalizedPurchaseOrder> {
    const po = await this.parser.parse(image);
    // Authoritatively stamp the platform regardless of what the parser returned.
    return po.platform === 'zestt' ? po : { ...po, platform: 'zestt' };
  }

  listOrders(): Promise<NormalizedPurchaseOrder[]> {
    throw new Error(DOCUMENT_ONLY);
  }
  listDeliveriesScheduled(): Promise<NormalizedPurchaseOrder[]> {
    throw new Error(DOCUMENT_ONLY);
  }
  getOrder(): Promise<NormalizedPurchaseOrder> {
    throw new Error(DOCUMENT_ONLY);
  }
  listSuppliers(): Promise<NormalizedSupplier[]> {
    throw new Error(DOCUMENT_ONLY);
  }
  listProducts(): Promise<NormalizedProduct[]> {
    throw new Error(DOCUMENT_ONLY);
  }
}
