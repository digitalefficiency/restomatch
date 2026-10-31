import { describe, expect, it } from 'vitest';
import { isShowcaseScanUrl } from '../lib/showcaseUpload';
import { stripTrailingSlashes } from '../lib/urls';

describe('stripTrailingSlashes (CodeQL js/polynomial-redos)', () => {
  it('drops every trailing slash and nothing else', () => {
    expect(stripTrailingSlashes('https://x.supabase.co///')).toBe('https://x.supabase.co');
    expect(stripTrailingSlashes('https://x.supabase.co')).toBe('https://x.supabase.co');
    expect(stripTrailingSlashes('a//b/')).toBe('a//b');
    expect(stripTrailingSlashes('///')).toBe('');
    expect(stripTrailingSlashes('')).toBe('');
  });

  it('is linear on many slashes not at the end (the regex was quadratic)', () => {
    const evil = `${'/'.repeat(100_000)}x`;
    const t0 = performance.now();
    expect(stripTrailingSlashes(evil)).toBe(evil);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it('isShowcaseScanUrl still accepts a base URL configured with trailing slashes', () => {
    const base = 'https://proj.supabase.co//';
    const url = 'https://proj.supabase.co/storage/v1/object/sign/invoice-scans/walk-ins/abc.jpg?token=t';
    expect(isShowcaseScanUrl(url, 'https://proj.supabase.co')).toBe(true);
    expect(isShowcaseScanUrl(url, base)).toBe(true);
  });
});
