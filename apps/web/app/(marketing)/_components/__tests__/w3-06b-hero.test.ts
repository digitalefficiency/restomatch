import { describe, expect, it } from 'vitest';
import { PHONE_MEDIA, heroMedia, loopSourcesFor } from '@/lib/heroMedia';

describe('W3-06b · the phone gets the 9:16 loop, never both', () => {
  const desk = heroMedia.loop;
  const phone = heroMedia.phoneLoop;

  it('ships the 9:16 cut (S10) with a 9:16 poster', () => {
    expect(phone).toEqual({
      webm: '/media/hero-loop-9x16.webm',
      mp4: '/media/hero-loop-9x16.mp4',
      poster: '/media/hero-poster-9x16.jpg',
    });
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
