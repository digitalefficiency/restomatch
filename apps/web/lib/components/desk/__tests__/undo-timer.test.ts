import { describe, expect, it } from 'vitest';
import {
  pauseUndoClock,
  resumeUndoClock,
  startUndoClock,
  UNDO_RESUME_MIN_MS,
  undoExpired,
  undoFraction,
  undoLeftMs,
} from '../undoTimer';

/** DS3-04 §5.5: 10 s visible from mount, never past sentAt + 12 s; the cap wins while paused. */
const VISIBLE = 10_000;
const CAP = 12_000;
const T0 = 1_763_700_000_000; // sentAt, epoch ms

describe('the undo clock', () => {
  it('a fresh clock closes at 10 s', () => {
    const c = startUndoClock(T0, T0 + CAP, VISIBLE);
    expect(c.endsAt).toBe(T0 + 10_000);
    expect(undoLeftMs(c, T0)).toBe(10_000);
    expect(undoLeftMs(c, T0 + 9_999)).toBe(1);
    expect(undoExpired(c, T0 + 9_999)).toBe(false);
    expect(undoExpired(c, T0 + 10_000)).toBe(true);
    expect(undoLeftMs(c, T0 + 20_000)).toBe(0);
  });

  it('a slow mount (sentAt + 3 s) closes at 12 s, not 13 s', () => {
    const c = startUndoClock(T0 + 3_000, T0 + CAP, VISIBLE);
    expect(c.endsAt).toBe(T0 + 12_000);
    expect(undoLeftMs(c, T0 + 3_000)).toBe(9_000);
    expect(undoExpired(c, T0 + 11_999)).toBe(false);
    expect(undoExpired(c, T0 + 12_000)).toBe(true);
    expect(undoExpired(c, T0 + 12_999)).toBe(true);
    // a mount after the cap offers nothing
    expect(undoLeftMs(startUndoClock(T0 + 13_000, T0 + CAP, VISIBLE), T0 + 13_000)).toBe(0);
  });

  it('paused at 5 s and still paused at 12 s → expired: the cap wins', () => {
    const paused = pauseUndoClock(startUndoClock(T0, T0 + CAP, VISIBLE), T0 + 5_000);
    expect(paused.paused).toBe(true);
    expect(paused.remaining).toBe(5_000);
    expect(undoLeftMs(paused, T0 + 6_000)).toBe(5_000); // held
    expect(undoLeftMs(paused, T0 + 7_000)).toBe(5_000);
    expect(undoLeftMs(paused, T0 + 9_000)).toBe(3_000); // the cap is nearer now
    expect(undoExpired(paused, T0 + 11_999)).toBe(false);
    expect(undoExpired(paused, T0 + 12_000)).toBe(true);
    // pausing again changes nothing
    expect(pauseUndoClock(paused, T0 + 8_000)).toBe(paused);
  });

  it('resume with 200 ms left → 800 ms, clamped by the cap', () => {
    const paused = pauseUndoClock(startUndoClock(T0, T0 + CAP, VISIBLE), T0 + 9_800);
    expect(paused.remaining).toBe(200);
    const resumed = resumeUndoClock(paused, T0 + 10_000);
    expect(resumed.paused).toBe(false);
    expect(UNDO_RESUME_MIN_MS).toBe(800);
    expect(undoLeftMs(resumed, T0 + 10_000)).toBe(800);
    expect(resumed.endsAt).toBe(T0 + 10_800);
    // resumed close to the cap: 800 ms would pass it, so the cap decides
    const late = resumeUndoClock(paused, T0 + 11_500);
    expect(late.endsAt).toBe(T0 + 12_000);
    expect(undoLeftMs(late, T0 + 11_500)).toBe(500);
    // a long pause keeps its own time left when that is more than 800 ms
    const early = resumeUndoClock(pauseUndoClock(startUndoClock(T0, T0 + CAP, VISIBLE), T0 + 2_000), T0 + 3_000);
    expect(undoLeftMs(early, T0 + 3_000)).toBe(8_000);
    expect(early.endsAt).toBe(T0 + 11_000);
    // resuming a running clock changes nothing
    expect(resumeUndoClock(resumed, T0 + 10_100)).toBe(resumed);
  });

  it('the fraction runs 1 → 0 and stays frozen while paused unless the cap is nearer', () => {
    const c = startUndoClock(T0, T0 + CAP, VISIBLE);
    expect(undoFraction(c, T0)).toBe(1);
    expect(undoFraction(c, T0 + 5_000)).toBe(0.5);
    expect(undoFraction(c, T0 + 10_000)).toBe(0);
    expect(undoFraction(c, T0 + 30_000)).toBe(0);
    const paused = pauseUndoClock(c, T0 + 5_000);
    expect(undoFraction(paused, T0 + 5_000)).toBe(0.5);
    expect(undoFraction(paused, T0 + 6_500)).toBe(0.5); // frozen
    expect(undoFraction(paused, T0 + 7_000)).toBe(0.5); // the cap is exactly as near as the time held
    expect(undoFraction(paused, T0 + 11_000)).toBe(0.1); // the cap is nearer: it runs out
    expect(undoFraction(paused, T0 + 12_000)).toBe(0);
    expect(undoFraction({ ...c, visibleMs: 0 }, T0)).toBe(0);
  });
});
