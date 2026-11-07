import { describe, expect, it } from 'vitest';
import { MAX_FILES, STAGES, addFiles, isPreviewable, removeFileAt, stageNumber } from '../leakCheckForm.logic';

const f = (name: string, size = 1, lastModified = 1) => ({ name, size, lastModified });

describe('W3-06b · phone leak-check form rules', () => {
  it('appends picks one by one, skipping exact duplicates', () => {
    const a = addFiles([], [f('a.jpg')]);
    const b = addFiles(a.files, [f('a.jpg'), f('b.jpg')]);
    expect(b.files.map((x) => x.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(b.dropped).toBe(0);
    // same name, different photo → kept
    expect(addFiles(b.files, [f('a.jpg', 2)]).files).toHaveLength(3);
  });

  it('stops at the cap and counts what did not fit', () => {
    const many = Array.from({ length: MAX_FILES + 3 }, (_, i) => f(`p${i}.jpg`));
    const r = addFiles([], many);
    expect(r.files).toHaveLength(MAX_FILES);
    expect(r.dropped).toBe(3);
  });

  it('the ✕ removes exactly that file', () => {
    expect(removeFileAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('stages are determinate: 1, 2, 3 of 3', () => {
    expect(STAGES.map(stageNumber)).toEqual([1, 2, 3]);
  });

  it('previews images only', () => {
    expect(isPreviewable('image/jpeg')).toBe(true);
    expect(isPreviewable('application/pdf')).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatIls } from '@/lib/money';
import { noteAmountText } from '../result/noteAmount';

describe('W3-06b · a missing note amount never prints ₪0 (G-16 money-swallow)', () => {
  const fmt = (a: number) => formatIls(a / 100, { maximumFractionDigits: 2, locale: 'he' });
  it('null / undefined / NaN → the neutral "unavailable" word, no ₪', () => {
    for (const v of [null, undefined, Number.NaN]) {
      const out = noteAmountText(v, fmt, 'סכום לא זמין');
      expect(out).toBe('סכום לא זמין');
      expect(out).not.toMatch(/₪|0/);
    }
  });
  it('a real amount (including a real zero) is formatted', () => {
    expect(noteAmountText(12_345, fmt, 'x')).toContain('123.45');
    expect(noteAmountText(0, fmt, 'x')).toMatch(/0/);
  });
  it('the result page has no `amountAgorot ?? 0` left', () => {
    const page = readFileSync(join(__dirname, '../result/page.tsx'), 'utf8');
    expect(page).not.toMatch(/amountAgorot\s*\?\?\s*0/);
  });
});
