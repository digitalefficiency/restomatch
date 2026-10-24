import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { heroLoopFor, heroMedia, promoVideoFor } from '../heroMedia';

const PUBLIC = resolve(__dirname, '../../public');

/** Every root-relative /media path the hero/promo config points at. */
function referencedMedia(): string[] {
  const paths: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/\/media\/[\w.-]+/g)) paths.push(m[0]);
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(heroMedia);
  return [...new Set(paths)];
}

describe('heroMedia', () => {
  it('serves the English promo film and hero loop to English visitors', () => {
    expect(promoVideoFor('en')?.src).toBe('/media/promo-en-720.mp4');
    expect(heroLoopFor('en').mp4).toBe('/media/hero-loop-en.mp4');
  });

  it('keeps Hebrew as the default', () => {
    expect(promoVideoFor('he')?.src).toBe('/media/promo-he-720.mp4');
    expect(heroLoopFor('he')).toMatchObject({ mp4: heroMedia.loop.mp4, poster: heroMedia.poster });
  });

  it('every referenced /media file exists in public/', () => {
    const missing = referencedMedia().filter((p) => !existsSync(resolve(PUBLIC, `.${p}`)));
    expect(missing).toEqual([]);
  });
});
