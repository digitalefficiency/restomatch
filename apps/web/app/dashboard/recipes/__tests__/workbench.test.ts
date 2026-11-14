import { describe, expect, it } from 'vitest';
import { buildPreviewInput, type DraftState } from '../workbench';

const base: DraftState = { name: 'שניצל', isSub: false, yieldQty: '1', yieldUnit: 'מנה', menuPrice: '69', includesVat: true, lines: [] };
const line = (key: string, quantity: string, extra: Partial<DraftState['lines'][number]> = {}) => ({
  key,
  productId: `p-${key}`,
  subRecipeId: null,
  quantity,
  unit: 'גרם',
  wastePct: '0',
  unitsPerProductUnit: '',
  ...extra,
});

describe('buildPreviewInput (W3-02)', () => {
  it('sends only lines that parse, in order, and maps keys to preview lines', () => {
    const b = buildPreviewInput({ ...base, lines: [line('a', '200'), line('b', ''), line('c', '1,250'), line('d', 'x'), line('e', '0,5', { wastePct: '12.5' })] });
    expect(b.keys).toEqual(['a', 'e']);
    expect(b.input!.items.map((i) => [i.quantity, i.wastePct])).toEqual([['200', 0], ['0.5', 12.5]]);
    expect(b.problems.get('c')).toEqual({ kind: 'ambiguous', raw: '1,250' });
    expect(b.problems.get('d')).toEqual({ kind: 'invalid' });
    expect(b.problems.has('b')).toBe(false);
  });
  it('menu price in agorot (comma decimal ok); a sub-recipe sends none; empty name still previews', () => {
    expect(buildPreviewInput({ ...base, menuPrice: '68,50' }).input!.menuPriceAgorot).toBe(6850);
    expect(buildPreviewInput({ ...base, isSub: true, menuPrice: '68' }).input!.menuPriceAgorot).toBeNull();
    expect(buildPreviewInput({ ...base, name: '  ' }).input!.name).toBe('—');
  });
  it('a bad yield, a bad menu price or waste > 95% blocks what cannot be costed', () => {
    expect(buildPreviewInput({ ...base, yieldQty: '0' }).input).toBeNull();
    expect(buildPreviewInput({ ...base, menuPrice: 'abc' }).input).toBeNull();
    const b = buildPreviewInput({ ...base, lines: [line('a', '1', { wastePct: '96' }), line('b', '1', { unitsPerProductUnit: '0' })] });
    expect(b.keys).toEqual([]);
    expect([...b.problems.keys()]).toEqual(['a', 'b']);
  });
});
