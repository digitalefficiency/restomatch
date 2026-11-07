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
