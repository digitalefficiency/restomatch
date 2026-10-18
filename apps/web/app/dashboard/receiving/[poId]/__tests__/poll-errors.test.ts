import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/lib/i18n/translate';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingErrorText } from '../_errors';
import { DEFAULT_POLL_MS, pollDelay, pollInvoiceUntilRead } from '../_poll';

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('pollInvoiceUntilRead (EN-4)', () => {
  it('waits up to ~120 s by default — far beyond the old 30 s', async () => {
    const clock = fakeClock();
    let calls = 0;
    const r = await pollInvoiceUntilRead({
      fetch: async () => {
        calls += 1;
        return { status: clock.now() >= 90_000 ? 'parsed' : 'ocr_pending' };
      },
      ...clock,
    });
    expect(r.outcome).toBe('ready');
    expect(clock.now()).toBeGreaterThanOrEqual(90_000);
    expect(calls).toBeLessThan(60); // backs off, doesn't hammer
  });

  it('times out after maxMs and reports progress', async () => {
    const clock = fakeClock();
    const ticks: number[] = [];
    const r = await pollInvoiceUntilRead({
      fetch: async () => ({ status: 'ocr_pending' }),
      onTick: (ms) => ticks.push(ms),
      ...clock,
    });
    expect(r.outcome).toBe('timeout');
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(DEFAULT_POLL_MS);
  });

  it('stops immediately on a terminal OCR failure', async () => {
    const r = await pollInvoiceUntilRead({
      fetch: async () => ({ status: 'parsed', ocrFailed: true }),
      ...fakeClock(),
    });
    expect(r.outcome).toBe('failed');
  });

  it('can be cancelled (retake / "continue with the order")', async () => {
    let cancel = false;
    const clock = fakeClock();
    const r = await pollInvoiceUntilRead({
      fetch: async () => {
        if (clock.now() > 5_000) cancel = true;
        return { status: 'ocr_pending' };
      },
      isCancelled: () => cancel,
      ...clock,
    });
    expect(r.outcome).toBe('cancelled');
  });

  it('backs off 1 s → 2 s → 4 s', () => {
    expect([pollDelay(0), pollDelay(15_000), pollDelay(70_000)]).toEqual([1000, 2000, 4000]);
  });
});

describe('receivingErrorText (WIZ-ERR-1)', () => {
  const he = createTranslator('he', receiving);
  const en = createTranslator('en', receiving);
  const trpcErr = (data: Record<string, unknown>, message = 'Internal server error') =>
    Object.assign(new TRPCClientError(message), { data });

  it('never shows raw server / fetch text', () => {
    expect(receivingErrorText(trpcErr({ code: 'INTERNAL_SERVER_ERROR' }), en, 'en')).toBe(en('errors.generic'));
    expect(receivingErrorText(new Error('Internal server error'), en, 'en')).toBe(en('errors.generic'));
    expect(receivingErrorText(new TypeError('Failed to fetch'), en, 'en')).toBe(en('errors.network'));
    expect(receivingErrorText(trpcErr({}, 'Failed to fetch'), he, 'he')).toBe(he('errors.generic'));
  });

  it('keeps meaningful errors: NOT_FOUND, mapped codes, coded domain errors', () => {
    expect(receivingErrorText(trpcErr({ code: 'NOT_FOUND' }), en, 'en')).toBe(en('errors.notFound'));
    const forbidden = receivingErrorText(trpcErr({ code: 'FORBIDDEN' }, 'Required role: owner, got: chef'), en, 'en');
    expect(forbidden).not.toContain('Required role');
    expect(forbidden).not.toBe(en('errors.generic'));
    const quota = receivingErrorText(trpcErr({ code: 'FORBIDDEN', appCode: 'quota.exceeded' }), en, 'en');
    expect(quota).not.toBe(en('errors.generic'));
    expect(/[֐-׿]/.test(quota)).toBe(false);
  });
});
