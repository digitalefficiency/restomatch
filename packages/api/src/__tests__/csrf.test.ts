import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../csrf';

const HOST = 'app.restomatch.co';

describe('isOriginAllowed', () => {
  it('allows same-origin POST', () => {
    expect(
      isOriginAllowed({ method: 'POST', origin: `https://${HOST}`, host: HOST }),
    ).toBe(true);
  });

  it('rejects cross-origin POST', () => {
    expect(
      isOriginAllowed({ method: 'POST', origin: 'https://evil.example', host: HOST }),
    ).toBe(false);
  });

  it('rejects a cross-origin POST even with a spoofed path', () => {
    expect(
      isOriginAllowed({ method: 'POST', origin: 'https://evil.example/app.restomatch.co', host: HOST }),
    ).toBe(false);
  });

  it('accepts an allowed AUTH_URL origin when host differs (proxy)', () => {
    expect(
      isOriginAllowed({
        method: 'POST',
        origin: 'https://app.restomatch.co',
        host: 'internal-1.fly.dev',
        allowedUrls: ['https://app.restomatch.co'],
      }),
    ).toBe(true);
  });

  it('rejects POST with no Origin header', () => {
    expect(isOriginAllowed({ method: 'POST', origin: null, host: HOST })).toBe(false);
  });

  it('allows GET with no Origin header (same-origin navigation)', () => {
    expect(isOriginAllowed({ method: 'GET', origin: null, host: HOST })).toBe(true);
  });

  it('rejects a malformed Origin', () => {
    expect(isOriginAllowed({ method: 'POST', origin: 'not a url', host: HOST })).toBe(false);
  });
});
