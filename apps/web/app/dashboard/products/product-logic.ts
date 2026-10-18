/** Pure product-editor helpers (unit-tested). */

export interface ProductFormState {
  canonicalName: string;
  nameEn: string;
  category: string;
  defaultUnit: string;
  barcodeEan: string;
  supplierId: string;
}

type Patch = {
  canonicalName?: string;
  nameEn?: string | null;
  category?: string | null;
  defaultUnit?: string | null;
  barcodeEan?: string | null;
  supplierId?: string | null;
};

/**
 * Only the fields that actually changed (trimmed; empty → null), or null when
 * nothing changed — `products.update` rejects an empty patch, and sending every
 * field each time would overwrite a concurrent edit to a field the user never
 * touched.
 */
export function productPatch(initial: ProductFormState, form: ProductFormState): Patch | null {
  const patch: Patch = {};
  const norm = (v: string) => v.trim();
  if (norm(form.canonicalName) !== norm(initial.canonicalName)) patch.canonicalName = norm(form.canonicalName);
  for (const k of ['nameEn', 'category', 'defaultUnit', 'barcodeEan'] as const) {
    if (norm(form[k]) !== norm(initial[k])) patch[k] = norm(form[k]) || null;
  }
  if (form.supplierId !== initial.supplierId) patch.supplierId = form.supplierId || null;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Bulk English-names grid: turn the edited cells into a `products.setNamesEn`
 * batch — only cells whose trimmed value differs from what's stored, blanks
 * meaning "clear". Untouched or reverted cells are left out.
 */
export function namesBatch(
  rows: Array<{ id: string; nameEn: string | null }>,
  edits: Record<string, string>,
): Array<{ productId: string; nameEn: string | null }> {
  const out: Array<{ productId: string; nameEn: string | null }> = [];
  for (const r of rows) {
    if (!(r.id in edits)) continue;
    const next = edits[r.id]!.trim();
    if (next === (r.nameEn ?? '').trim()) continue;
    out.push({ productId: r.id, nameEn: next || null });
  }
  return out;
}
