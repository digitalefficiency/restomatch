import { and, desc, eq, isNull, productAliases, sql, type Database } from '@restomatch/db';
import { normalizeLinkName, provenanceConfidence, type ConfirmedProvenance } from './linkPolicy';
import { normNameSql } from './normName';

export interface RecordConfirmedMatchParams {
  productId: string;
  rawName: string;
  supplierId?: string | null;
  supplierSku?: string | null;
  /**
   * REQUIRED (G-08): who proved this link. `human` → 1.000; `exactKey` /
   * `newProduct` → 0.999 (interim encoding until G-03's `source` column). A
   * guess (embedding / fuzzy) or a review row never reaches this function, so
   * there is no default: a missing provenance is a type error.
   */
  provenance: ConfirmedProvenance;
}

export interface RecordConfirmedMatchResult {
  aliasId: string;
  created: boolean;
  /** The alias's confidence before this call (null when created) — an undo restores it (G-08). */
  previousConfidence: string | null;
}

/**
 * Record a CONFIRMED alias between a supplier's raw name (or SKU)
 * and an internal product. Idempotent: re-confirming an existing alias
 * just updates its confidence to the provenance's encoding.
 */
export async function recordConfirmedMatch(
  db: Database,
  params: RecordConfirmedMatchParams,
): Promise<RecordConfirmedMatchResult> {
  const rawName = params.rawName.trim();
  const confidence = provenanceConfidence(params.provenance);
  if (!rawName) {
    throw new Error('rawName is required');
  }

  const supplierId = params.supplierId ?? null;
  const supplierFilter = supplierId
    ? eq(productAliases.supplierId, supplierId)
    : isNull(productAliases.supplierId);

  const existing = await db
    .select({ id: productAliases.id, confidence: productAliases.confidence })
    .from(productAliases)
    .where(
      and(
        eq(productAliases.productId, params.productId),
        // G-08: the same NORMALIZED name is the same alias (spacing, gershayim, NBSP).
        sql`${normNameSql(productAliases.supplierNameRaw)} = ${normalizeLinkName(rawName)}`,
        supplierFilter,
      ),
    )
    .orderBy(desc(productAliases.confidence), desc(productAliases.createdAt))
    .limit(1);

  if (existing[0]) {
    // Backfill the SKU onto an existing (name-keyed) alias so a SKU learned
    // after the name still lands — otherwise supplier_sku only ever gets set on
    // first insert and matchBySku could never resolve this alias.
    // Never downgrade: a machine re-learn must not demote a person's 1.000.
    const kept = Number(existing[0].confidence ?? 0) > Number(confidence) ? existing[0].confidence! : confidence;
    const updates: { confidence: string; supplierSku?: string } = { confidence: kept };
    if (params.supplierSku) updates.supplierSku = params.supplierSku;
    await db.update(productAliases).set(updates).where(eq(productAliases.id, existing[0].id));
    return { aliasId: existing[0].id, created: false, previousConfidence: existing[0].confidence ?? null };
  }

  const [inserted] = await db
    .insert(productAliases)
    .values({
      productId: params.productId,
      supplierId,
      supplierSku: params.supplierSku ?? null,
      supplierNameRaw: rawName,
      confidence,
    })
    .returning({ id: productAliases.id });

  if (!inserted) {
    throw new Error('failed to insert product_alias');
  }
  return { aliasId: inserted.id, created: true, previousConfidence: null };
}
