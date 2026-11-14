import { describe, expect, it } from 'vitest';
import { buildMergePreview, type MergeSide } from '../catalog/mergePreview';

const side = (o: Partial<MergeSide> & { productId: string; name: string }): MergeSide => ({
  baseUnit: 'kg',
  aliases: [],
  catalogItems: [],
  recipeIds: [],
  openOrderLineIds: [],
  contractIds: [],
  ...o,
});

describe('W3-10 merge preview', () => {
  it('counts what moves and dedupes aliases', () => {
    const p = buildMergePreview(
      side({
        productId: 'from',
        name: 'עגבניה שרי',
        aliases: ['עגבניות שרי', 'עגבניה'],
        catalogItems: [{ id: 'ci1', supplierId: 's1', supplierSku: 'T-1' }],
        recipeIds: ['r1', 'r2'],
        openOrderLineIds: ['o1'],
      }),
      side({ productId: 'into', name: 'עגבניה', recipeIds: ['r2'], catalogItems: [{ id: 'ci9', supplierId: 's2', supplierSku: null }] }),
    );
    expect(p).toMatchObject({
      aliasesAdded: ['עגבניה שרי', 'עגבניות שרי'],
      catalogItemsMoved: 1,
      recipesRepointed: 1,
      openOrderLinesRepointed: 1,
      contractsMoved: 0,
      conflicts: [],
      clean: true,
    });
  });

  it('lists conflicts instead of deciding them', () => {
    const p = buildMergePreview(
      side({
        productId: 'from',
        name: 'שמן זית',
        baseUnit: 'l',
        catalogItems: [{ id: 'f1', supplierId: 's1', supplierSku: 'O' }],
        contractIds: [{ id: 'k1', supplierId: 's1' }],
      }),
      side({
        productId: 'into',
        name: 'שמן זית כתית',
        baseUnit: 'kg',
        catalogItems: [{ id: 'i1', supplierId: 's1', supplierSku: 'O2' }],
        contractIds: [{ id: 'k2', supplierId: 's1' }],
      }),
    );
    expect(p.clean).toBe(false);
    expect(p.conflicts).toEqual([
      { kind: 'UNIT_DIFFERS', from: 'l', into: 'kg' },
      { kind: 'SAME_SUPPLIER_TWO_ROWS', supplierId: 's1', fromItemId: 'f1', intoItemId: 'i1' },
      { kind: 'TWO_CONTRACTS_SAME_SUPPLIER', supplierId: 's1', fromContractId: 'k1', intoContractId: 'k2' },
    ]);
  });

  it('refuses to merge a product into itself', () => {
    expect(() => buildMergePreview(side({ productId: 'x', name: 'a' }), side({ productId: 'x', name: 'a' }))).toThrow(RangeError);
  });
});
