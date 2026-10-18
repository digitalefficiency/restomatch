import { describe, expect, it } from 'vitest';
import { scrubPii, scrubSentryEvent, redactString } from '@restomatch/observability';

describe('Sentry PII scrub (E.9)', () => {
  it('redactString masks email and phone substrings', () => {
    const out = redactString('פנו אל dana@example.com או 050-123-4567 בהקדם');
    expect(out).not.toContain('dana@example.com');
    expect(out).not.toContain('050-123-4567');
    expect(out).toContain('[redacted-email]');
    expect(out).toContain('[redacted-phone]');
  });

  it('scrubPii drops sensitive keys and masks PII values deeply', () => {
    const input = {
      email: 'user@example.com',
      authorization: 'Bearer abc.def',
      apiKey: 'sk-secret',
      note: 'reach me at owner@resto.co.il',
      nested: { password: 'hunter2', phone: '+972 50 111 2222' },
      list: ['plain', { token: 'zzz' }],
    };
    const out = scrubPii(input) as Record<string, unknown>;
    expect(out.email).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.note).toContain('[redacted-email]');
    const nested = out.nested as Record<string, unknown>;
    expect(nested.password).toBe('[redacted]');
    expect(nested.phone).toBe('[redacted]');
    const list = out.list as unknown[];
    expect((list[1] as Record<string, unknown>).token).toBe('[redacted]');
  });

  it('handles cyclic structures without throwing', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(() => scrubPii(a)).not.toThrow();
  });

  it('scrubSentryEvent scrubs request data, extra, and drops user identifiers', () => {
    const event = {
      request: {
        data: { email: 'a@b.com', body: 'call 052-9998888' },
        cookies: 'authjs.session-token=secret',
        query_string: 'q=a@b.com',
      },
      extra: { trpcInput: { email: 'c@d.com' } },
      user: { id: 'user-1', email: 'a@b.com', ip_address: '1.2.3.4' },
    };
    const out = scrubSentryEvent(event);
    const req = out.request as Record<string, unknown>;
    expect((req.data as Record<string, unknown>).email).toBe('[redacted]');
    expect(req.cookies).toBe('[redacted]');
    expect(req.query_string).toContain('[redacted-email]');
    expect((out.extra as Record<string, unknown>).trpcInput).toMatchObject({ email: '[redacted]' });
    const user = out.user as Record<string, unknown>;
    expect(user.id).toBe('user-1'); // kept for grouping
    expect(user.email).toBeUndefined();
    expect(user.ip_address).toBeUndefined();
  });
});
