import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_MEDIA_FILES,
  PHONE_MEDIA,
  REJECTED_PHONE_LOOP_SHA256,
  heroMedia,
  loopSourcesFor,
  phoneLoopFor,
  promoVideoFor,
  referencedMediaPaths,
} from '@/lib/heroMedia';

const sha256Of = (publicPath: string) =>
  createHash('sha256').update(readFileSync(join(__dirname, '../../../../public', publicPath))).digest('hex');

describe('W3-06b · the phone gets the 9:16 loop, never both', () => {
  const desk = heroMedia.loop;
  /** A stand-in 9:16 cut for the source-choice tests (independent of the ship gate). */
  const phone = { webm: '/media/x-9x16.webm', mp4: '/media/x-9x16.mp4', poster: '/media/x-9x16.jpg' };

  it('SHIP GATE (SEC-2): every /media file heroMedia references matches an approved sample-month render', () => {
    const paths = referencedMediaPaths();
    // Sanity: the walker sees the loops, posters, srcSet WebPs and the phone cut.
    expect(paths).toEqual(
      expect.arrayContaining([
        '/media/hero-loop.webm',
        '/media/hero-poster-1280.webp',
        '/media/hero-poster-en-768.webp',
        '/media/hero-loop-9x16.mp4',
      ]),
    );
    for (const f of paths) {
      expect(APPROVED_MEDIA_FILES[f], `${f} is not approved`).toBeDefined();
      expect(sha256Of(f), `${f} bytes differ from the approved render`).toBe(APPROVED_MEDIA_FILES[f]);
    }
  });

  it('the walker also catches a promo film once it is re-enabled', () => {
    const withPromo = {
      ...heroMedia,
      promoVideo: { he: { src: '/media/promo-he-720.mp4', poster: '/media/promo-poster-he.jpg' } },
    } as typeof heroMedia;
    const paths = referencedMediaPaths(withPromo);
    expect(paths).toContain('/media/promo-he-720.mp4');
    expect(paths).toContain('/media/promo-poster-he.jpg');
    // …and the old-figure promo files are not approved.
    expect(APPROVED_MEDIA_FILES['/media/promo-he-720.mp4']).toBeUndefined();
  });

  it('M1: the promo film is off for Thu 12.11 (old ₪760 figures) — no "Watch 60 seconds" button', () => {
    // S10 re-renders the films from sampleMonth.ts after Thursday; re-enable only
    // with the NEW files SHA-allow-listed in APPROVED_MEDIA_FILES.
    expect(heroMedia.promoVideo).toBeNull();
    expect(promoVideoFor('he')).toBeNull();
    expect(promoVideoFor('en')).toBeNull();
  });

  it('Q1: the Hebrew-only 9:16 cut is served to Hebrew phones only; English phones get HeroMatch', () => {
    expect(phoneLoopFor('he')).toBe(heroMedia.phoneLoop);
    expect(phoneLoopFor('en')).toBeNull();
  });

  it('the first S10 cut (₪760 · 1.8%, a second figure set) is never approved', () => {
    for (const hash of Object.values(APPROVED_MEDIA_FILES)) expect(REJECTED_PHONE_LOOP_SHA256).not.toContain(hash);
  });

  it('a phone gets only 9:16 sources, a desktop only 16:9 ones', () => {
    const p = loopSourcesFor(true, desk, phone);
    const d = loopSourcesFor(false, desk, phone);
    expect(Object.values(p).every((s) => s.includes('9x16'))).toBe(true);
    expect(Object.values(d).some((s) => s.includes('9x16'))).toBe(false);
  });

  it('without a phone cut, a phone falls back to the desktop pair (HeroMatch hides it)', () => {
    expect(loopSourcesFor(true, desk, null)).toEqual({ webm: desk.webm, mp4: desk.mp4 });
  });

  it('the phone breakpoint sits just under Tailwind sm (640px)', () => {
    expect(PHONE_MEDIA).toBe('(max-width: 639.98px)');
  });
});
