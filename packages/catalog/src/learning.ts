import { and, eq, isNull, productAliases, type Database } from '@restomatch/db';

export interface RecordConfirmedMatchParams {
  productId: string;
  rawName: string;
  supplierId?: string | null;
  supplierSku?: string | null;
  confidence?: number;
}

export interface RecordConfirmedMatchResult {
  aliasId: string;
  created: boolean;
}

/**
 * Record a confirmed alias between a supplier's raw name (or SKU)
 * and an internal product. Idempotent: re-confirming an existing alias
 * just updates its confidence.
 */
export async function recordConfirmedMatch(
  db: Database,
  params: RecordConfirmedMatchParams,
): Promise<RecordConfirmedMatchResult> {
  const rawName = params.rawName.trim();
  if (!rawName) {
    throw new Error('rawName is required');
  }

  const supplierId = params.supplierId ?? null;
  const supplierFilter = supplierId
    ? eq(productAliases.supplierId, supplierId)
    : isNull(productAliases.supplierId);

  const existing = await db
    .select({ id: productAliases.id })
    .from(productAliases)
    .where(
      and(
        eq(productAliases.productId, params.productId),
        eq(productAliases.supplierNameRaw, rawName),
        supplierFilter,
      ),
    )
    .limit(1);

  if (existing[0]) {
    if (params.confidence !== undefined) {
      await db
        .update(productAliases)
        .set({ confidence: params.confidence.toString() })
        .where(eq(productAliases.id, existing[0].id));
    }
    return { aliasId: existing[0].id, created: false };
  }

  const [inserted] = await db
    .insert(productAliases)
    .values({
      productId: params.productId,
      supplierId,
      supplierSku: params.supplierSku ?? null,
      supplierNameRaw: rawName,
      confidence: params.confidence?.toString() ?? '1.000',
    })
    .returning({ id: productAliases.id });

  if (!inserted) {
    throw new Error('failed to insert product_alias');
  }
  return { aliasId: inserted.id, created: true };
}
