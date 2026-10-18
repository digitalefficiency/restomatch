import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /scans/<scan-id> on a project built from the migrations: invoice_scans has no
 * row for a `scan-…` id (its invoice_id is a uuid there, and scans.upload's
 * mapping insert is best-effort), so the viewer must sign the object at the
 * caller's own `<restaurantId>/<scanId>.<ext>` path — and nothing else.
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

describe('resolveScan without an invoice_scans row', () => {
  it('signs the scan at the caller restaurant prefix', async () => {
    existing.add(`${A}/${SCAN}.pdf`);
    const { resolveScan } = await import('../server');
    const r = await resolveScan(SCAN, A, noInvoice);
    expect(r).toMatchObject({ source: 'supabase', mimeType: 'application/pdf' });
    expect(r?.signedUrl).toContain(`/invoice-scans/${A}/${SCAN}.pdf`);
    expect(signed.every((p) => p.startsWith(`invoice-scans/${A}/`))).toBe(true);
  });

  it("never reaches another tenant's object", async () => {
    existing.add(`${A}/${SCAN}.jpg`);
    const { resolveScan } = await import('../server');
    expect(await resolveScan(SCAN, B, noInvoice)).toBeNull();
    expect(signed.some((p) => p.includes(A))).toBe(false);
  });

  it('only signs ids minted by scans.upload', async () => {
    const { resolveScan } = await import('../server');
    expect(await resolveScan('../../etc/passwd', A, noInvoice)).toBeNull();
    expect(await resolveScan(`scan-x/../${B}/scan-a-b`, A, noInvoice)).toBeNull();
    expect(signed).toHaveLength(0);
  });
});
