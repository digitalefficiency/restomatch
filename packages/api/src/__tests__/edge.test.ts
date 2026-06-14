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
