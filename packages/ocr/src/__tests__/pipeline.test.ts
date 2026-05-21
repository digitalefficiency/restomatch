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
    confidence: 0.97,
    matchedBy: 'alias',
  };
  const cucumberMatch: ProductCandidate = {
    productId: 'cucumber-uuid',
    canonicalName: 'מלפפון חממה',
    confidence: 0.95,
    matchedBy: 'embedding',
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
