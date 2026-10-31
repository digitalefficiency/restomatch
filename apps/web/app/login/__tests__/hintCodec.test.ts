import { describe, expect, it } from 'vitest';
import { decodeHint, encodeHint, maskEmail, resendWaitSec, RESEND_COOLDOWN_SEC } from '../hintCodec';

describe('login hint codec (auth-06/-07/-25)', () => {
  it('round-trips the typed email, failure count, send time and destination', () => {
    const h = { email: 'dana@kfar.co.il', fails: 2, sentAt: 1_700_000_000_000, next: '/invite/accept?token=x' };
    expect(decodeHint(encodeHint(h))).toEqual(h);
  });

  it('treats anything malformed as no hint', () => {
    for (const raw of [undefined, '', 'not json', '{"e":5}', '{"e":""}', JSON.stringify({ e: 'a'.repeat(300) }), 'x'.repeat(2000)]) {
      expect(decodeHint(raw)).toBeNull();
    }
  });

  it('never carries an off-site destination', () => {
    expect(decodeHint(JSON.stringify({ e: 'a@b.co', n: '//evil.com' }))?.next).toBeNull();
    expect(decodeHint(JSON.stringify({ e: 'a@b.co', n: 'https://evil.com' }))?.next).toBeNull();
    expect(decodeHint(JSON.stringify({ e: 'a@b.co', f: -3 }))?.fails).toBe(0);
  });

  it('masks the address but keeps the domain readable', () => {
    expect(maskEmail('dana@kfar.co.il')).toBe('da•••@kfar.co.il');
    expect(maskEmail('a@b.co')).toBe('a•••@b.co');
    expect(maskEmail('nobody')).toBe('•••');
  });

  it('counts the resend cooldown down from the send time', () => {
    const now = 1_000_000;
    expect(resendWaitSec(null, now)).toBe(0);
    expect(resendWaitSec(now, now)).toBe(RESEND_COOLDOWN_SEC);
    expect(resendWaitSec(now - 10_500, now)).toBe(20);
    expect(resendWaitSec(now - 31_000, now)).toBe(0);
  });
});
