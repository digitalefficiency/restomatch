import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_MEDIA_FILES,
  PHONE_MEDIA,
  REJECTED_PHONE_LOOP_SHA256,
  REJECTED_PROMO_SHA256,
  heroMedia,
  loopSourcesFor,
  phoneLoopFor,
  promoVideoFor,
  referencedMediaPaths,
  replaceVideoSources,
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
    // …and the old-figure promo bytes can never be the approved ones.
    for (const hash of Object.values(APPROVED_MEDIA_FILES)) expect(REJECTED_PROMO_SHA256).not.toContain(hash);
  });

  it('promo re-enabled on S10\'s sample-month render (#318): both locales, SHA-pinned, old cut rejected', () => {
    expect(promoVideoFor('he')).toEqual({ src: '/media/promo-he-720.mp4', poster: '/media/promo-poster-he.jpg' });
    expect(promoVideoFor('en')).toEqual({ src: '/media/promo-en-720.mp4', poster: '/media/promo-poster-en.jpg' });
    for (const f of ['/media/promo-he-720.mp4', '/media/promo-en-720.mp4', '/media/promo-poster-he.jpg', '/media/promo-poster-en.jpg']) {
      expect(APPROVED_MEDIA_FILES[f]).toMatch(/^[0-9a-f]{64}$/);
      expect(REJECTED_PROMO_SHA256).not.toContain(APPROVED_MEDIA_FILES[f]);
    }
  });

  it('Q4: phones get the 9:16 poster as WebP (540w/810w), JPEG kept as the href fallback', () => {
    expect(heroMedia.phoneLoop?.posterSrcSet).toBe('/media/hero-poster-9x16-540.webp 540w, /media/hero-poster-9x16-810.webp 810w');
    expect(heroMedia.phoneLoop?.poster).toBe('/media/hero-poster-9x16.jpg');
    expect(referencedMediaPaths()).toEqual(expect.arrayContaining(['/media/hero-poster-9x16-540.webp', '/media/hero-poster-9x16-810.webp']));
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

describe('Q3 · HeroVideo replaces its <source>s on a re-run (locale switch)', () => {
  /** A minimal <video> stand-in: enough DOM for replaceVideoSources in a node test. */
  function fakeVideo() {
    const children: Array<{ src: string; type: string; remove: () => void }> = [];
    const video = {
      children,
      ownerDocument: {
        createElement: () => {
          const el = {
            src: '',
            type: '',
            remove: () => children.splice(children.indexOf(el), 1),
          };
          return el;
        },
      },
      appendChild: (el: (typeof children)[number]) => (children.push(el), el),
      querySelectorAll: () => [...children],
    };
    return video as unknown as HTMLVideoElement & { children: typeof children };
  }

  it('the second attach leaves only the new locale\'s sources, in order', () => {
    const v = fakeVideo();
    replaceVideoSources(v, [
      ['/media/hero-loop.webm', 'video/webm'],
      ['/media/hero-loop.mp4', 'video/mp4'],
    ]);
    const out = replaceVideoSources(v, [
      ['/media/hero-loop-en.webm', 'video/webm'],
      ['/media/hero-loop-en.mp4', 'video/mp4'],
    ]);
    const kids = (v as unknown as { children: Array<{ src: string }> }).children;
    expect(kids.map((c) => c.src)).toEqual(['/media/hero-loop-en.webm', '/media/hero-loop-en.mp4']);
    expect(out).toHaveLength(2);
  });
});

describe('M8 · HeroMatch (the en-phone hero) never sets ₪ in mono', () => {
  it('no font-mono class within 3 lines before a formatIls() call', () => {
    const src = readFileSync(join(__dirname, '../HeroMatch.tsx'), 'utf8').split('\n');
    const offenders = src
      .map((line, i) => ({ line: i + 1, hit: /formatIls\(/.test(line) && src.slice(Math.max(0, i - 3), i + 1).some((l) => /\bfont-mono\b/.test(l)) }))
      .filter((x) => x.hit)
      .map((x) => x.line);
    expect(offenders).toEqual([]);
  });
});
