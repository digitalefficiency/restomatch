import { describe, expect, it } from 'vitest';
import { clientIpFromHeaders, trpcRequestTargets } from '../edge';

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe('clientIpFromHeaders', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to x-real-ip', () => {
    expect(clientIpFromHeaders(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('returns "unknown" when no IP header is present (strict, shared bucket)', () => {
    expect(clientIpFromHeaders(headers({}))).toBe('unknown');
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': '   ' }))).toBe('unknown');
  });

  it('with trustedProxyHops=1, ignores a spoofed left-most XFF and trusts the proxy hop', () => {
    // Attacker prepends a fake IP; the real connecting IP is appended by our one
    // trusted proxy (right-most). The limiter must key on the real one.
    const h = headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' });
    expect(clientIpFromHeaders(h, { trustedProxyHops: 1 })).toBe('203.0.113.7');
    // ... and a longer forged chain still resolves to the trusted right-most hop.
    const h2 = headers({ 'x-forwarded-for': 'evil, evil2, 203.0.113.7' });
    expect(clientIpFromHeaders(h2, { trustedProxyHops: 1 })).toBe('203.0.113.7');
  });

  it('with trustedProxyHops=2, takes the second hop from the right', () => {
    const h = headers({ 'x-forwarded-for': 'client, 203.0.113.7, 10.0.0.1' });
    expect(clientIpFromHeaders(h, { trustedProxyHops: 2 })).toBe('203.0.113.7');
  });

  it('clamps when the chain is shorter than the configured hop count (no negative index)', () => {
    const h = headers({ 'x-forwarded-for': '203.0.113.7' });
    expect(clientIpFromHeaders(h, { trustedProxyHops: 3 })).toBe('203.0.113.7');
  });

  it('defaults to the left-most entry when no trusted hops are configured', () => {
    const h = headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(clientIpFromHeaders(h)).toBe('203.0.113.7');
  });
});

describe('trpcRequestTargets', () => {
  const base = 'https://app.restomatch.example/api/trpc/';

  it('matches a direct POST to the procedure', () => {
    expect(trpcRequestTargets('leads.create', 'POST', `${base}leads.create`)).toBe(true);
  });

  it('matches when the procedure is inside a batched path', () => {
    expect(trpcRequestTargets('leads.create', 'POST', `${base}leads.create,plans.list?batch=1`)).toBe(
      true,
    );
  });

  it('does not match a non-POST request (mutations are POST)', () => {
    expect(trpcRequestTargets('leads.create', 'GET', `${base}leads.create`)).toBe(false);
  });

  it('does not match a different procedure', () => {
    expect(trpcRequestTargets('leads.create', 'POST', `${base}plans.list`)).toBe(false);
  });

  it('does not match a substring procedure (exact segment only)', () => {
    expect(trpcRequestTargets('leads.create', 'POST', `${base}leads.createDraft`)).toBe(false);
  });

  it('returns false for a malformed URL', () => {
    expect(trpcRequestTargets('leads.create', 'POST', 'not a url')).toBe(false);
  });
});
