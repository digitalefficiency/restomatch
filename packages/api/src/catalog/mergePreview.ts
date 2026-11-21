/**
 * W3-10 · "מיזוג מוצרים" preview: what moves when product `from` is merged into
 * product `into`, shown before the merge is confirmed. Pure; the router loads
 * both sides. Nothing here writes, and the preview never decides a conflict:
 * it lists it so the owner chooses.
 */

export interface MergeSide {
  productId: string;
  name: string;
  baseUnit: string | null;
  aliases: string[];
  /** supplier catalog rows linked to the product. */
  catalogItems: Array<{ id: string; supplierId: string; supplierSku: string | null }>;
  recipeIds: string[];
  /** Open (not yet received) order lines. */
  openOrderLineIds: string[];
  contractIds: Array<{ id: string; supplierId: string }>;
}

export type MergeConflict =
  | { kind: 'UNIT_DIFFERS'; from: string | null; into: string | null }
  | { kind: 'SAME_SUPPLIER_TWO_ROWS'; supplierId: string; fromItemId: string; intoItemId: string }
  | { kind: 'TWO_CONTRACTS_SAME_SUPPLIER'; supplierId: string; fromContractId: string; intoContractId: string };

export interface MergePreview {
  fromId: string;
  intoId: string;
  aliasesAdded: string[];
  catalogItemsMoved: number;
  recipesRepointed: number;
  openOrderLinesRepointed: number;
  contractsMoved: number;
  conflicts: MergeConflict[];
  /** True when there is nothing to choose: the merge can be confirmed as is. */
  clean: boolean;
}

function aliasKey(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildMergePreview(from: MergeSide, into: MergeSide): MergePreview {
  if (from.productId === into.productId) throw new RangeError('cannot merge a product into itself');
  const have = new Set([into.name, ...into.aliases].map(aliasKey));
  const aliasesAdded: string[] = [];
  for (const a of [from.name, ...from.aliases]) {
    const k = aliasKey(a);
    if (!k || have.has(k)) continue;
    have.add(k);
    aliasesAdded.push(a.trim());
  }

  const conflicts: MergeConflict[] = [];
  const fu = from.baseUnit?.trim() || null;
  const iu = into.baseUnit?.trim() || null;
  if (fu && iu && fu.toLowerCase() !== iu.toLowerCase()) conflicts.push({ kind: 'UNIT_DIFFERS', from: fu, into: iu });

  const intoBySupplier = new Map(into.catalogItems.map((c) => [c.supplierId, c.id]));
  for (const c of from.catalogItems) {
    const other = intoBySupplier.get(c.supplierId);
    if (other) conflicts.push({ kind: 'SAME_SUPPLIER_TWO_ROWS', supplierId: c.supplierId, fromItemId: c.id, intoItemId: other });
  }
  const intoContracts = new Map(into.contractIds.map((c) => [c.supplierId, c.id]));
  for (const c of from.contractIds) {
    const other = intoContracts.get(c.supplierId);
    if (other) conflicts.push({ kind: 'TWO_CONTRACTS_SAME_SUPPLIER', supplierId: c.supplierId, fromContractId: c.id, intoContractId: other });
  }

  const intoRecipes = new Set(into.recipeIds);
  return {
    fromId: from.productId,
    intoId: into.productId,
    aliasesAdded,
    catalogItemsMoved: from.catalogItems.length,
    recipesRepointed: from.recipeIds.filter((r) => !intoRecipes.has(r)).length,
    openOrderLinesRepointed: from.openOrderLineIds.length,
    contractsMoved: from.contractIds.length,
    conflicts,
    clean: conflicts.length === 0,
  };
}
