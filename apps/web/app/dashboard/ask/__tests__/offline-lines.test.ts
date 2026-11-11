import * as React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AskResult } from '@restomatch/api';
import { createTranslator } from '@/lib/i18n/translate';
import { ask } from '@/lib/i18n/messages/ask';

// Runtime-only imports of the component (offlineLines uses none of them).
vi.mock('@/lib/trpc/client', () => ({ trpc: {} }));
vi.mock('@/lib/i18n/client', () => ({ useLocale: () => 'he', useT: () => () => '' }));
vi.mock('next/link', () => ({ default: () => null }));

// The web vitest config compiles .tsx with the classic JSX runtime: the component
// module needs React in scope to load (nothing is rendered here).
let offlineLines: typeof import('../ask-client').offlineLines;
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  ({ offlineLines } = await import('../ask-client'));
});

/**
 * G-12b · offline "what to claim" (leak-economist sign-off, 11.11): the before-VAT
 * total and count never absorb a duplicate (incl. VAT) or a VAT amount, so
 * "nothing to claim" shows only when NO basis has a line.
 */
const result = (facts: Record<string, unknown>): AskResult => ({
  mode: 'offline',
  answer: null,
  citations: [],
  grounded: true,
  intent: 'claimWeek',
  facts,
  links: [],
  reason: 'noKey',
});
const he = createTranslator('he', ask);

describe('offlineLines · claimWeek', () => {
  it('a duplicate-only restaurant (incl. VAT) is NOT "nothing to claim"', () => {
    const lines = offlineLines(
      result({ totalIls: 0, count: 0, otherBasisCount: 1, duplicateInclVatIls: 80, vatIls: 0, items: [] }),
      he,
      'he',
    );
    expect(lines.join(' ')).not.toContain('אין כרגע פערים');
    expect(lines[0]).toContain('חשבוניות כפולות');
    expect(lines[0]).toContain('כולל מע״מ');
  });

  it('before-VAT lines: the intro states its basis; other bases follow apart, never added', () => {
    const lines = offlineLines(
      result({ totalIls: 50, count: 2, otherBasisCount: 1, duplicateInclVatIls: 80, vatIls: 0, items: [] }),
      he,
      'he',
    );
    expect(lines[0]).toContain('לפני מע״מ');
    expect(lines[1]).toContain('חשבוניות כפולות');
    expect(lines.join(' ')).not.toMatch(/130/);
  });

  it('nothing on any basis → "nothing to claim"', () => {
    const lines = offlineLines(result({ totalIls: 0, count: 0, otherBasisCount: 0, items: [] }), he, 'he');
    expect(lines).toEqual([he('answers.claimNone')]);
  });
});
