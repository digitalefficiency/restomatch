import { beforeEach, describe, expect, it, vi } from 'vitest';

// signedUrlForStoragePath is the tenant gate in front of the SERVICE-ROLE
// signer (OCR-A #224 delta review item 1/2): an exact allowlist of our scan
// object names, and a storage error is thrown (retryable upstream), not
// swallowed into "no URL".
const h = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  signedPaths: [] as string[],
}));

vi.mock('../lib/supabaseStorage', () => ({
  extFromMime: () => 'jpg',
  getServiceStorageClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, ttl: number) => {
          h.signedPaths.push(path);
          return h.createSignedUrl(path, ttl);
        },
      }),
    },
  }),
}));

const { isTenantScanPath, signedUrlForStoragePath } = await import('../ingest/store');

const RID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OBJ = 'scan-abc123-def456.jpg';

describe('isTenantScanPath: exactly <restaurantId>/scan-<id>-<hex>[.<ext>]', () => {
  it('accepts every name our writers produce', () => {
    expect(isTenantScanPath(RID, `${RID}/${OBJ}`)).toBe(true);
    expect(isTenantScanPath(RID, `${RID}/scan-mh3k2x9a-1f2e3d4c.pdf`)).toBe(true); // scans.upload (base36-uuid8)
    expect(isTenantScanPath(RID, `${RID}/scan-0123456789ab-cdef0123.webp`)).toBe(true); // deterministicScanId
    expect(isTenantScanPath(RID, `${RID}/scan-0123456789ab-cdef0123.bin`)).toBe(true); // extFromMime fallback
    expect(isTenantScanPath(RID, `${RID}/scan-0123456789ab-cdef0123`)).toBe(true);
  });

  it.each([
    ['another tenant', `${OTHER}/${OBJ}`],
    ['%2e%2e', `${RID}/%2e%2e/${OTHER}/${OBJ}`],
    ['.%2E', `${RID}/.%2E/${OTHER}/${OBJ}`],
    ['%2E.', `${RID}/%2E./${OTHER}/${OBJ}`],
    ['tab-split dots', `${RID}/.\t./${OTHER}/${OBJ}`],
    ['CR/LF-split dots', `${RID}/.\r\n./${OTHER}/${OBJ}`],
    ['literal ..', `${RID}/../${OTHER}/${OBJ}`],
    ['a sub-folder', `${RID}/sub/${OBJ}`],
    ['a query', `${RID}/${OBJ}?download=1`],
    ['a fragment', `${RID}/${OBJ}#x`],
    ['an encoded dot in the name', `${RID}/scan-abc123-def456%2Ejpg`],
    ['a leading slash', `/${RID}/${OBJ}`],
    ['a backslash', `${RID}\\${OBJ}`],
    ['the prefix alone', `${RID}/`],
    ['an empty tenant', `/${OBJ}`],
  ])('refuses %s', (_label, path) => {
    expect(isTenantScanPath(RID, path)).toBe(false);
  });

  it('an empty restaurantId never matches', () => {
    expect(isTenantScanPath('', `/${OBJ}`)).toBe(false);
  });
});

describe('signedUrlForStoragePath', () => {
  beforeEach(() => {
    h.createSignedUrl.mockReset();
    h.signedPaths.length = 0;
  });

  it('signs a tenant scan path', async () => {
    h.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/invoice-scans/p?token=t' }, error: null });
    await expect(signedUrlForStoragePath(RID, `${RID}/${OBJ}`)).resolves.toMatch(/token=t$/);
    expect(h.signedPaths).toEqual([`${RID}/${OBJ}`]);
  });

  it('never hands an encoded traversal to the service-role signer', async () => {
    for (const p of [`${RID}/%2e%2e/${OTHER}/${OBJ}`, `${RID}/.%2E/${OTHER}/${OBJ}`, `${RID}/.\t./${OTHER}/${OBJ}`]) {
      await expect(signedUrlForStoragePath(RID, p)).resolves.toBeNull();
    }
    expect(h.signedPaths).toEqual([]);
  });

  it('throws the storage error (the OCR job retries a 5xx) instead of returning null', async () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    h.createSignedUrl.mockResolvedValue({ data: null, error: err });
    await expect(signedUrlForStoragePath(RID, `${RID}/${OBJ}`)).rejects.toBe(err);
  });
});
