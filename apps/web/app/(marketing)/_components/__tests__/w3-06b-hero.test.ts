import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_PHONE_LOOP_FILES,
  PHONE_MEDIA,
  REJECTED_PHONE_LOOP_SHA256,
  heroMedia,
  loopSourcesFor,
} from '@/lib/heroMedia';

const sha256Of = (publicPath: string) =>
  createHash('sha256').update(readFileSync(join(__dirname, '../../../../public', publicPath))).digest('hex');

describe('W3-06b · the phone gets the 9:16 loop, never both', () => {
  const desk = heroMedia.loop;
  /** A stand-in 9:16 cut for the source-choice tests (independent of the ship gate). */
  const phone = { webm: '/media/x-9x16.webm', mp4: '/media/x-9x16.mp4', poster: '/media/x-9x16.jpg' };

  it('SHIP GATE: phoneLoop is null, or every file on disk matches an approved sample-month render', () => {
    const live = heroMedia.phoneLoop;
    if (live === null) return;
    for (const f of [live.webm, live.mp4, live.poster]) {
      expect(APPROVED_PHONE_LOOP_FILES[f], `${f} is not approved`).toBeDefined();
      expect(sha256Of(f), `${f} bytes differ from the approved render`).toBe(APPROVED_PHONE_LOOP_FILES[f]);
    }
  });

  it('the first S10 cut (₪760 · 1.8%, a second figure set) is never approved', () => {
    for (const hash of Object.values(APPROVED_PHONE_LOOP_FILES)) expect(REJECTED_PHONE_LOOP_SHA256).not.toContain(hash);
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
