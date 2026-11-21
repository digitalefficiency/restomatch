import { describe, expect, it } from 'vitest';
import { MOVED_ABOUT_HASHES, movedAboutTarget } from '../aboutForward.logic';

describe('Q5 · old /about#section deep links forward to /product#section', () => {
  it.each(MOVED_ABOUT_HASHES)('%s → /product%s', (hash) => {
    expect(movedAboutTarget(hash)).toBe(`/product${hash}`);
  });

  it('keeps the query (?lang=en) so the language survives the hop', () => {
    expect(movedAboutTarget('#roi', '?lang=en')).toBe('/product?lang=en#roi');
  });

  it('anything else stays on /about (no hash, unknown hash, look-alikes)', () => {
    for (const h of ['', '#', '#story', '#roi-x', '#ROI', 'roi']) expect(movedAboutTarget(h)).toBeNull();
  });
});
