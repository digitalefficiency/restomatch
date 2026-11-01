import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G-09: /scans/<invoice uuid> resolves an invoice's raw_image_url in BOTH
 * shapes a row may hold — a (legacy or unsigned) bucket URL and the bare
 * storage path `<restaurantId>/<scanId>.<ext>` — and signs only objects under
 * the caller's own prefix.
 */
const signed: string[] = [];
const existing = new Set<string>();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'invalid input syntax for type uuid' } }),
          }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          signed.push(`${bucket}/${path}`);
          return existing.has(path)
            ? { data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null }
            : { data: null, error: { message: 'Object not found' } };
        },
      }),
    },
  }),
}));

vi.mock('@restomatch/api', () => ({
  readLocalScanMeta: async () => null,
  scanIdFromLocalUrl: () => null,
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SCAN = 'scan-0a1b2c3d4e5f-6a7b8c9d';
const noInvoice = async () => null;

beforeEach(() => {
  vi.resetModules();
  signed.length = 0;
  existing.clear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const INV = '33333333-3333-4333-8333-333333333333';
const invoiceUrl = (url: string) => async (id: string) => (id === INV ? url : null);

describe('resolveScan by invoice uuid: both raw_image_url shapes', () => {
  it('a legacy signed URL (token expired or not) is re-signed at its path', async () => {
    existing.add(`${A}/${SCAN}.jpg`);
    const { resolveScan } = await import('../server');
    const r = await resolveScan(INV, A, invoiceUrl(`https://x.supabase.co/storage/v1/object/sign/invoice-scans/${A}/${SCAN}.jpg?token=old`));
    expect(r?.signedUrl).toContain(`/invoice-scans/${A}/${SCAN}.jpg`);
    expect(r?.mimeType).toBe('image/jpeg');
  });

  it('the unsigned object URL resolves the same object', async () => {
    existing.add(`${A}/${SCAN}.pdf`);
    const { resolveScan } = await import('../server');
    const r = await resolveScan(INV, A, invoiceUrl(`https://x.supabase.co/storage/v1/object/sign/invoice-scans/${A}/${SCAN}.pdf`));
    expect(r).toMatchObject({ source: 'supabase', mimeType: 'application/pdf' });
  });

  it('a bare storage path resolves the same object', async () => {
    existing.add(`${A}/${SCAN}.pdf`);
    const { resolveScan } = await import('../server');
    const r = await resolveScan(INV, A, invoiceUrl(`${A}/${SCAN}.pdf`));
    expect(r).toMatchObject({ source: 'supabase', mimeType: 'application/pdf' });
    expect(r?.signedUrl).toContain(`/invoice-scans/${A}/${SCAN}.pdf`);
  });

  it("a bare path under another tenant's prefix, a traversal or a sub-folder signs nothing", async () => {
    existing.add(`${B}/${SCAN}.pdf`);
    const { resolveScan } = await import('../server');
    expect(await resolveScan(INV, A, invoiceUrl(`${B}/${SCAN}.pdf`))).toBeNull();
    expect(await resolveScan(INV, A, invoiceUrl(`${A}/../${B}/${SCAN}.pdf`))).toBeNull();
    expect(await resolveScan(INV, A, invoiceUrl(`${A}/sub/${SCAN}.pdf`))).toBeNull();
    expect(signed).toHaveLength(0);
  });
});
