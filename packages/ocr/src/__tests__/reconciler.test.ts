import { describe, expect, it } from 'vitest';
import { reconcile } from '../reconciler';
import {
  AGREEMENT_PERFECT,
  EMPTY_INVOICE,
  HEBREW_OCR_NOISE,
  MISSING_LINE_IN_CLAUDE,
  REORDERED_LINES,
  ROUNDING_DIFF,
  SINGLE_DISAGREEMENT,
} from './fixtures';

describe('reconcile', () => {
  it('agreement yields confidence 1 and no conflicts', () => {
    const { result, conflicts, confidence } = reconcile(
      AGREEMENT_PERFECT.docAi,
      AGREEMENT_PERFECT.claude,
    );
    expect(conflicts).toEqual([]);
    expect(confidence).toBe(1);
    expect(result.supplier.name).toBe('ירקני אבי');
    expect(result.lines).toHaveLength(2);
  });

  it('flags single field disagreement and resolves to Claude', () => {
    const { result, conflicts, confidence } = reconcile(
      SINGLE_DISAGREEMENT.docAi,
      SINGLE_DISAGREEMENT.claude,
    );
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.field.includes('unitPrice'))).toBe(true);
    expect(conflicts[0]?.resolvedBy).toBe('claude_vision');
    expect(result.lines[0]?.unitPrice).toBe(8); // Claude's value wins
    expect(confidence).toBeLessThan(1);
  });

  it('Hebrew OCR noise: Claude wins over Document AI on text fields', () => {
    const { result, conflicts } = reconcile(HEBREW_OCR_NOISE.docAi, HEBREW_OCR_NOISE.claude);
    expect(result.supplier.name).toBe('ירקני אבי');
    expect(conflicts.some((c) => c.field === 'supplier.name')).toBe(true);
  });

  it('detects line missing in one provider', () => {
    const { result, conflicts } = reconcile(
      MISSING_LINE_IN_CLAUDE.docAi,
      MISSING_LINE_IN_CLAUDE.claude,
    );
    expect(result.lines).toHaveLength(2);
    const missingConflict = conflicts.find((c) => c.claude === null);
    expect(missingConflict).toBeDefined();
    expect(missingConflict?.resolvedBy).toBe('document_ai');
  });

  it('matches lines despite different order', () => {
    const { result, conflicts } = reconcile(REORDERED_LINES.docAi, REORDERED_LINES.claude);
    expect(result.lines).toHaveLength(2);
    expect(conflicts).toEqual([]);
  });

  it('numeric values within ±₪0.10 considered agreement', () => {
    const { conflicts } = reconcile(ROUNDING_DIFF.docAi, ROUNDING_DIFF.claude);
    expect(conflicts.some((c) => c.field.includes('vat'))).toBe(false);
  });

  it('handles empty invoice gracefully', () => {
    const { result, confidence } = reconcile(EMPTY_INVOICE.docAi, EMPTY_INVOICE.claude);
    expect(result.lines).toEqual([]);
    // Only supplier.name is compared → no conflicts → confidence 1
    expect(confidence).toBe(1);
  });

  it('any disagreement drops confidence below 1', () => {
    const a = reconcile(AGREEMENT_PERFECT.docAi, AGREEMENT_PERFECT.claude);
    const b = reconcile(SINGLE_DISAGREEMENT.docAi, SINGLE_DISAGREEMENT.claude);
    const c = reconcile(MISSING_LINE_IN_CLAUDE.docAi, MISSING_LINE_IN_CLAUDE.claude);
    expect(a.confidence).toBe(1);
    expect(b.confidence).toBeLessThan(1);
    expect(c.confidence).toBeLessThan(1);
  });

  it('one provider null: uses the other without conflict', () => {
    const docAi = AGREEMENT_PERFECT.docAi;
    const claude = { ...docAi, supplier: { name: undefined, businessId: undefined } };
    const { result, conflicts } = reconcile(docAi, claude);
    expect(result.supplier.name).toBe(docAi.supplier.name);
    expect(conflicts.some((c) => c.field === 'supplier.name')).toBe(false);
  });

  it('every conflict has all required fields populated', () => {
    const { conflicts } = reconcile(SINGLE_DISAGREEMENT.docAi, SINGLE_DISAGREEMENT.claude);
    for (const c of conflicts) {
      expect(c.field).toBeTruthy();
      expect(c.resolvedBy).toMatch(/^(document_ai|claude_vision|agreement|derived)$/);
      expect(c.resolved).toBeDefined();
    }
  });
});
