import { parseDecimalInput } from './decimal';

/**
 * W3-02 · turn the editor's typed state into a `recipes.preview` input. Pure
 * (no React) so the mapping is unit-tested: a line whose quantity, waste or
 * bridge does not parse is SKIPPED (marked on the row, never sent as a guess),
 * and `keys[i]` is the row behind the preview's `lines[i]`.
 */
export interface DraftLine {
  key: string;
  productId: string | null;
  subRecipeId: string | null;
  quantity: string;
  unit: string;
  wastePct: string;
  unitsPerProductUnit: string;
}

export interface DraftState {
  id?: string;
  name: string;
  isSub: boolean;
  yieldQty: string;
  yieldUnit: string;
  menuPrice: string;
  includesVat: boolean;
  lines: DraftLine[];
}

export type LineProblem = { kind: 'ambiguous'; raw: string } | { kind: 'invalid' };

export interface PreviewInput {
  id?: string;
  name: string;
  isSubRecipe: boolean;
  yieldQty: string;
  yieldUnit: string;
  menuPriceAgorot: number | null;
  menuPriceIncludesVat: boolean;
  items: {
    productId: string | null;
    subRecipeId: string | null;
    quantity: string;
    unit: string;
    wastePct: number;
    unitsPerProductUnit: string | null;
  }[];
}

export interface BuiltPreview {
  /** null when the header itself cannot be costed yet (bad yield / menu price). */
  input: PreviewInput | null;
  keys: string[];
  problems: Map<string, LineProblem>;
}

const MAX_MENU_AGOROT = 10_000_000;

export function buildPreviewInput(s: DraftState): BuiltPreview {
  const problems = new Map<string, LineProblem>();
  const keys: string[] = [];
  const items: PreviewInput['items'] = [];
  for (const l of s.lines) {
    const q = parseDecimalInput(l.quantity, 'qty');
    if (q.kind === 'empty') continue; // a fresh row: nothing to cost, nothing to flag
    if (q.kind === 'ambiguous') {
      problems.set(l.key, { kind: 'ambiguous', raw: q.raw });
      continue;
    }
    if (q.kind !== 'ok' || q.value <= 0) {
      problems.set(l.key, { kind: 'invalid' });
      continue;
    }
    const w = parseDecimalInput(l.wastePct || '0', 'qty');
    const wasteBp = w.kind === 'ok' ? Math.round(w.value * 100) : NaN;
    const b = parseDecimalInput(l.unitsPerProductUnit, 'qty');
    if (!Number.isFinite(wasteBp) || wasteBp > 9500 || (b.kind !== 'empty' && (b.kind !== 'ok' || b.value <= 0))) {
      problems.set(l.key, { kind: 'invalid' });
      continue;
    }
    keys.push(l.key);
    items.push({
      productId: l.productId,
      subRecipeId: l.subRecipeId,
      quantity: q.text,
      unit: l.unit,
      wastePct: wasteBp / 100,
      unitsPerProductUnit: b.kind === 'ok' ? b.text : null,
    });
  }
  const y = parseDecimalInput(s.yieldQty || '1', 'qty');
  const m = s.isSub ? ({ kind: 'empty' } as const) : parseDecimalInput(s.menuPrice, 'ils');
  const headerOk = y.kind === 'ok' && y.value > 0 && (m.kind === 'empty' || (m.kind === 'ok' && m.agorot <= MAX_MENU_AGOROT));
  return {
    input: headerOk
      ? {
          id: s.id,
          // The preview needs a name to validate; it is never stored.
          name: s.name.trim().slice(0, 120) || '—',
          isSubRecipe: s.isSub,
          yieldQty: y.text,
          yieldUnit: s.yieldUnit.trim() || 'מנה',
          menuPriceAgorot: m.kind === 'ok' ? m.agorot : null,
          menuPriceIncludesVat: s.includesVat,
          items,
        }
      : null,
    keys,
    problems,
  };
}
