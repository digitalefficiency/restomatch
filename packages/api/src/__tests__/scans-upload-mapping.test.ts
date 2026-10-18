import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, testDbUrl } from '@restomatch/db';
import type { AppContext } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * scans.upload against a project built from the migrations: invoice_scans has
 * `invoice_id uuid` + FK there, so PostgREST rejects the `scan-…` mapping row
 * (22P02). The upload itself must still succeed — the receiving wizard only
 * needs the signed URL to register the invoice for OCR.
 */
const removed: string[] = [];
let insertError: { message: string; code?: string } | null = null;

vi.mock('../lib/supabaseStorage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/supabaseStorage')>();
  return {
    ...real,
    getServiceStorageClient: () => ({
      from: () => ({ insert: async () => ({ error: insertError }) }),
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          remove: async (paths: string[]) => {
            removed.push(...paths);
            return { error: null };
          },
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/invoice-scans/${path}?token=t` },
            error: null,
          }),
        }),
      },
    }),
  };
});

const { appRouter } = await import('../index');
const db = createDb(testDbUrl());
let A: Tenant;

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});

afterAll(async () => {
  await resetDb(db);
});

function caller() {
  const ctx: AppContext = { db, session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role: 'receiver' } };
  return appRouter.createCaller(ctx);
}

describe('scans.upload — invoice_scans mapping is best-effort', () => {
  it('returns the signed URL and keeps the object when the mapping insert is rejected', async () => {
    insertError = { message: 'invalid input syntax for type uuid: "scan-…"', code: '22P02' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await caller().scans.upload({ contentBase64: 'iVBORw0KGgo=', mimeType: 'image/png', clientUploadId: '33333333-3333-4333-8333-333333333333' });
    expect(r.storagePath).toMatch(new RegExp(`^${A.restaurantId}/scan-[a-f0-9]+-[a-f0-9]+\\.png$`));
    expect(r.signedUrl).toContain(r.storagePath);
    expect(removed).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mapping skipped'));
    warn.mockRestore();
  });

  it('still succeeds when the mapping insert works', async () => {
    insertError = null;
    const r = await caller().scans.upload({ contentBase64: 'iVBORw0KGgo=', mimeType: 'application/pdf' });
    expect(r.storagePath.endsWith('.pdf')).toBe(true);
    expect(r.scanRouteUrl).toBe(`/scans/${r.invoiceId}`);
  });
});
