import { describe, expect, it } from 'vitest';
import { allowedScanUrlPrefix, isAllowedScanUrl } from '../lib/scanUrls';

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' } as NodeJS.ProcessEnv;
const OK = 'https://abc.supabase.co/storage/v1/object/sign/invoice-scans/r1/scan.pdf?token=x';

describe('scan URL pinning (S4 / A.8)', () => {
  it('derives the signed-URL prefix from the Supabase URL', () => {
    expect(allowedScanUrlPrefix(ENV)).toBe('https://abc.supabase.co/storage/v1/object/sign/invoice-scans/');
    expect(allowedScanUrlPrefix({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co/' } as NodeJS.ProcessEnv)).toBe(
      'https://abc.supabase.co/storage/v1/object/sign/invoice-scans/',
    );
    expect(allowedScanUrlPrefix({ INVOICE_SCAN_URL_PREFIX: 'https://cdn.example/x/' } as NodeJS.ProcessEnv)).toBe(
      'https://cdn.example/x/',
    );
  });

  it('accepts a signed invoice-scans URL', () => {
    expect(isAllowedScanUrl(OK, ENV)).toBe(true);
  });

  it.each([
    'https://example.com/invoice.jpg',
    'http://169.254.169.254/latest/meta-data',
    'https://abc.supabase.co/storage/v1/object/public/invoice-scans/r1/scan.pdf',
    'https://abc.supabase.co/storage/v1/object/sign/other-bucket/x.pdf',
    'https://abc.supabase.co.evil.test/storage/v1/object/sign/invoice-scans/x',
    'https://abc.supabase.co/storage/v1/object/sign/invoice-scans/../../secret',
    'https://abc.supabase.co/storage/v1/object/sign/invoice-scans/',
  ])('rejects %s', (url) => {
    expect(isAllowedScanUrl(url, ENV)).toBe(false);
  });

  it('is a no-op when storage is not configured (local/test)', () => {
    expect(isAllowedScanUrl('https://example.com/invoice.jpg', {} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('isAllowedScanUrl without a storage prefix (security review)', () => {
  it('fails CLOSED in production when no Supabase URL is configured', () => {
    expect(isAllowedScanUrl('http://169.254.169.254/latest/meta-data', { NODE_ENV: 'production' })).toBe(false);
  });
  it('stays open only for local/test setups without storage', () => {
    expect(isAllowedScanUrl('http://localhost:3000/scans/x/file', { NODE_ENV: 'development' })).toBe(true);
  });
});
