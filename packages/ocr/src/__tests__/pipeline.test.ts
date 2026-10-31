import { describe, expect, it, vi } from 'vitest';
import type { InvoiceOcrLine } from '@restomatch/types';
import { StubOcrProvider } from '../providers/stub';
import { runOcrPipeline } from '../pipeline';
import type { CatalogMatcherFn, ProductCandidate } from '../types';
import {
  AGREEMENT_PERFECT,
  HEBREW_OCR_NOISE,
  MISSING_LINE_IN_CLAUDE,
  SINGLE_DISAGREEMENT,
} from './fixtures';

function makeProviders(fixture: typeof AGREEMENT_PERFECT) {
  return {
    documentAi: new StubOcrProvider('document_ai', fixture.docAi),
    claude: new StubOcrProvider('claude_vision', fixture.claude),
  };
}

describe('runOcrPipeline — basics', () => {
  it('returns reconciled output with both providers in the result', async () => {
    const result = await runOcrPipeline('test-image', makeProviders(AGREEMENT_PERFECT));
    expect(result.providers.documentAi).toBe(AGREEMENT_PERFECT.docAi);
    expect(result.providers.claude).toBe(AGREEMENT_PERFECT.claude);
    expect(result.primary).toBe(AGREEMENT_PERFECT.claude);
  });

  it('agreement scenario → high confidence + no review needed', async () => {
    const result = await runOcrPipeline('test-image', makeProviders(AGREEMENT_PERFECT));
    expect(result.confidence).toBe(1);
    expect(result.needsHumanReview).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  it('disagreement scenario → confidence drops, flagged for review', async () => {
    const result = await runOcrPipeline('test-image', {
      ...makeProviders(SINGLE_DISAGREEMENT),
      reviewThreshold: 0.95,
    });
    expect(result.confidence).toBeLessThan(1);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('Hebrew OCR noise: pipeline picks Claude version', async () => {
    const result = await runOcrPipeline('test-image', makeProviders(HEBREW_OCR_NOISE));
    expect(result.reconciled.supplier.name).toBe('ירקני אבי');
  });
});

describe('runOcrPipeline — catalog integration', () => {
  const tomatoMatch: ProductCandidate = {
    productId: 'tomato-uuid',
    canonicalName: 'עגבניה שרי',
    // G-08: a person's alias (1.000) — an exact key the default decider links.
    confidence: 1,
    matchedBy: 'alias',
  };
  const cucumberMatch: ProductCandidate = {
    productId: 'cucumber-uuid',
    canonicalName: 'מלפפון חממה',
    // G-08: an exact supplier SKU (catalog-item branch, 0.999).
    confidence: 0.999,
    matchedBy: 'sku',
  };

  it('attaches product candidates from catalog matcher', async () => {
    const matcher: CatalogMatcherFn = async (line: InvoiceOcrLine) => {
      if (line.rawDescription.includes('עגבניה')) return [tomatoMatch];
      if (line.rawDescription.includes('מלפפון')) return [cucumberMatch];
      return [];
    };

    const result = await runOcrPipeline('test-image', {
      ...makeProviders(AGREEMENT_PERFECT),
      catalogMatcher: matcher,
    });

    expect(result.reconciled.lines[0]?.productId).toBe('tomato-uuid');
    expect(result.reconciled.lines[1]?.productId).toBe('cucumber-uuid');
    expect(result.reconciled.lines[0]?.productCandidates).toHaveLength(1);
  });

  it('low-confidence match (<0.95): leaves productId null but surfaces candidate', async () => {
    const matcher: CatalogMatcherFn = async () => [{
      productId: 'maybe-tomato',
      canonicalName: 'עגבניה',
      confidence: 0.6,
      matchedBy: 'fuzzy',
    }];

    const result = await runOcrPipeline('test-image', {
      ...makeProviders(AGREEMENT_PERFECT),
      catalogMatcher: matcher,
    });

    expect(result.reconciled.lines[0]?.productId).toBeNull();
    expect(result.reconciled.lines[0]?.productCandidates).toHaveLength(1);
  });

  describe('G-08 link policy', () => {
    const run = (cands: ProductCandidate[], decideLink?: Parameters<typeof runOcrPipeline>[1]['decideLink']) =>
      runOcrPipeline('test-image', {
        ...makeProviders(AGREEMENT_PERFECT),
        catalogMatcher: async () => cands,
        ...(decideLink ? { decideLink } : {}),
      });
    const c = (confidence: number, matchedBy: ProductCandidate['matchedBy']): ProductCandidate => ({
      productId: 'p1',
      canonicalName: 'מוצר',
      confidence,
      matchedBy,
    });

    it('a 0.97 fuzzy candidate with no decider → productId null (review), candidate kept', async () => {
      const r = await run([c(0.97, 'fuzzy')]);
      expect(r.reconciled.lines[0]?.productId).toBeNull();
      expect(r.reconciled.lines[0]?.productCandidates).toHaveLength(1);
    });

    it('a ≥0.95 embedding or a 0.97 (legacy/guessed) alias is not an exact key → null', async () => {
      expect((await run([c(0.99, 'embedding')])).reconciled.lines[0]?.productId).toBeNull();
      expect((await run([c(0.97, 'alias')])).reconciled.lines[0]?.productId).toBeNull();
      expect((await run([c(0.9, 'sku')])).reconciled.lines[0]?.productId).toBeNull();
    });

    it('a guess provenance is never linked, even at 1.0', async () => {
      const r = await run([{ ...c(1, 'sku'), provenance: 'guess' } as ProductCandidate]);
      expect(r.reconciled.lines[0]?.productId).toBeNull();
    });

    it('sku / barcode / a 1.000 alias → linked', async () => {
      expect((await run([c(0.999, 'sku')])).reconciled.lines[0]?.productId).toBe('p1');
      expect((await run([c(1, 'barcode')])).reconciled.lines[0]?.productId).toBe('p1');
      expect((await run([c(1, 'alias')])).reconciled.lines[0]?.productId).toBe('p1');
    });

    it('with an injected decider, its decision is used (called with unitPack unknown)', async () => {
      const decider = vi.fn(() => ({ decision: 'auto' as const, productId: 'decided' }));
      const r = await run([c(0.61, 'fuzzy')], decider);
      expect(r.reconciled.lines[0]?.productId).toBe('decided');
      expect(decider).toHaveBeenCalledWith([c(0.61, 'fuzzy')], { unitPack: 'unknown' });

      const reviewer = vi.fn(() => ({ decision: 'review' as const, productId: null }));
      expect((await run([c(1, 'sku')], reviewer)).reconciled.lines[0]?.productId).toBeNull();
    });
  });

  it('no catalog matcher → lines have null productId and empty candidates', async () => {
    const result = await runOcrPipeline('test-image', makeProviders(AGREEMENT_PERFECT));
    for (const line of result.reconciled.lines) {
      expect(line.productId).toBeNull();
      expect(line.productCandidates).toEqual([]);
    }
  });

  it('triggers human review when matcher returns empty for some lines', async () => {
    const matcher: CatalogMatcherFn = async () => [];
    const result = await runOcrPipeline('test-image', {
      ...makeProviders(AGREEMENT_PERFECT),
      catalogMatcher: matcher,
    });
    expect(result.needsHumanReview).toBe(true);
  });

  it('matcher is called once per reconciled line', async () => {
    const matcher = vi.fn<CatalogMatcherFn>(async () => []);
    const result = await runOcrPipeline('test-image', {
      ...makeProviders(AGREEMENT_PERFECT),
      catalogMatcher: matcher,
    });
    expect(matcher).toHaveBeenCalledTimes(result.reconciled.lines.length);
  });
});

describe('runOcrPipeline — review threshold', () => {
  it('confidence above default threshold → no review needed', async () => {
    const result = await runOcrPipeline('test-image', makeProviders(AGREEMENT_PERFECT));
    expect(result.needsHumanReview).toBe(false);
  });

  it('custom threshold can force review even on perfect agreement', async () => {
    const result = await runOcrPipeline('test-image', {
      ...makeProviders(AGREEMENT_PERFECT),
      reviewThreshold: 1.01,
    });
    expect(result.needsHumanReview).toBe(true);
  });
});

describe('runOcrPipeline — provider failures', () => {
  it('propagates errors from document_ai', async () => {
    const failing = {
      id: 'document_ai' as const,
      extract: vi.fn().mockRejectedValue(new Error('docAi exploded')),
    };
    await expect(
      runOcrPipeline('img', {
        documentAi: failing,
        claude: new StubOcrProvider('claude_vision', AGREEMENT_PERFECT.claude),
      }),
    ).rejects.toThrow('docAi exploded');
  });

  it('propagates errors from claude', async () => {
    const failing = {
      id: 'claude_vision' as const,
      extract: vi.fn().mockRejectedValue(new Error('claude exploded')),
    };
    await expect(
      runOcrPipeline('img', {
        documentAi: new StubOcrProvider('document_ai', AGREEMENT_PERFECT.docAi),
        claude: failing,
      }),
    ).rejects.toThrow('claude exploded');
  });
});

describe('runOcrPipeline — missing lines edge case', () => {
  it('keeps document_ai-only line even when claude missed it', async () => {
    const result = await runOcrPipeline('test-image', makeProviders(MISSING_LINE_IN_CLAUDE));
    expect(result.reconciled.lines).toHaveLength(2);
    expect(result.reconciled.lines.some((l) => l.rawDescription === 'בצל יבש')).toBe(true);
  });
});

describe('runOcrPipeline — M11 single provider in both slots', () => {
  it('calls a provider ONCE when the same instance fills both slots', async () => {
    const provider = new StubOcrProvider('claude_vision', AGREEMENT_PERFECT.claude);
    const spy = vi.spyOn(provider, 'extract');
    const result = await runOcrPipeline('https://example.com/inv.jpg', {
      documentAi: provider,
      claude: provider,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.conflicts).toHaveLength(0);
    expect(result.confidence).toBe(1);
  });

  it('still calls both when they are distinct providers', async () => {
    const a = new StubOcrProvider('document_ai', AGREEMENT_PERFECT.claude);
    const b = new StubOcrProvider('claude_vision', AGREEMENT_PERFECT.claude);
    const sa = vi.spyOn(a, 'extract');
    const sb = vi.spyOn(b, 'extract');
    await runOcrPipeline('x', { documentAi: a, claude: b });
    expect(sa).toHaveBeenCalledTimes(1);
    expect(sb).toHaveBeenCalledTimes(1);
  });
});

describe('runOcrPipeline — English rendering', () => {
  it('carries rawDescriptionEn from the Claude extraction onto reconciled lines', async () => {
    const withEn = {
      ...AGREEMENT_PERFECT.claude,
      lines: AGREEMENT_PERFECT.claude.lines.map((l, i) => ({ ...l, rawDescriptionEn: `English ${i}` })),
    };
    const result = await runOcrPipeline('x', {
      documentAi: new StubOcrProvider('document_ai', AGREEMENT_PERFECT.claude),
      claude: new StubOcrProvider('claude_vision', withEn),
    });
    expect(result.reconciled.lines.map((l) => l.rawDescriptionEn)).toEqual(
      AGREEMENT_PERFECT.claude.lines.map((_, i) => `English ${i}`),
    );
  });
});

describe('runOcrPipeline — unreadable lines (EN-3)', () => {
  it('a zero-filled low-confidence line sends the invoice to human review, never straight to matching', async () => {
    const claude = {
      ...AGREEMENT_PERFECT.claude,
      lines: [
        ...AGREEMENT_PERFECT.claude.lines,
        { rawDescription: 'עגבניות', sku: 'T1', qty: 0, unit: '', unitPrice: 25, lineTotal: 0, confidence: 0.2 } as InvoiceOcrLine,
      ],
    };
    const p = new StubOcrProvider('claude_vision', claude);
    const result = await runOcrPipeline('test-image', { documentAi: p, claude: p });
    expect(result.confidence).toBe(1);
    expect(result.needsHumanReview).toBe(true);
  });

  it('ordinary line confidence (0.8) does not force review', async () => {
    const claude = {
      ...AGREEMENT_PERFECT.claude,
      lines: AGREEMENT_PERFECT.claude.lines.map((l) => ({ ...l, confidence: 0.8 })),
    };
    const p = new StubOcrProvider('claude_vision', claude);
    expect((await runOcrPipeline('test-image', { documentAi: p, claude: p })).needsHumanReview).toBe(false);
  });
});
