import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import {
  localScanStorageEnabled,
  readLocalScan,
  saveLocalScan,
  scanIdFromLocalUrl,
} from '../lib/localScanStorage';
import { __resetServiceStorageClient } from '../lib/supabaseStorage';
import { deterministicScanId } from '../routers/scans';
import { resetDb, seedTenant, type Tenant } from './fixtures';

const db = createDb(testDbUrl());
const PNG = Buffer.from('iVBORw0KGgo=', 'base64');
const ENV_KEYS = ['NODE_ENV', 'LOCAL_SCAN_DIR', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LOCAL_SCAN_STORAGE'] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let dir: string;
let A: Tenant;
let B: Tenant;

function callerFor(t: Tenant) {
  const ctx: AppContext = { db, session: { userId: t.ownerUserId, restaurantId: t.restaurantId, role: 'receiver' } };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
  B = await seedTenant(db, 'B');
});

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  dir = await mkdtemp(join(tmpdir(), 'rm-scans-'));
  process.env.LOCAL_SCAN_DIR = dir;
  (process.env as Record<string, string>).NODE_ENV = 'development';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LOCAL_SCAN_STORAGE;
  __resetServiceStorageClient();
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else (process.env as Record<string, string>)[k] = saved[k]!;
  }
  __resetServiceStorageClient();
  await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await resetDb(db);
});

describe('local scan storage guard', () => {
  it('is NEVER enabled in production', () => {
    expect(localScanStorageEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('is off when Supabase storage is configured or explicitly disabled', () => {
    expect(
      localScanStorageEnabled({
        NODE_ENV: 'development',
        NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(localScanStorageEnabled({ NODE_ENV: 'development', LOCAL_SCAN_STORAGE: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(localScanStorageEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
  });
  it('refuses to write in production even if called directly', async () => {
    await expect(
      saveLocalScan({
        restaurantId: A.restaurantId,
        scanId: 'scan-abc-12345678',
        ext: 'png',
        mimeType: 'image/png',
        bytes: PNG,
        env: { NODE_ENV: 'production', LOCAL_SCAN_DIR: dir } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow(/disabled/);
  });
  it('rejects path-traversal scan ids', async () => {
    await expect(
      saveLocalScan({ restaurantId: A.restaurantId, scanId: '../../etc/passwd', ext: 'png', mimeType: 'image/png', bytes: PNG }),
    ).rejects.toThrow(/invalid scan id/);
    expect(await readLocalScan(A.restaurantId, '../x')).toBeNull();
  });
});

describe('scans.upload without Supabase (local demo)', () => {
  it('stores the file locally and returns a local URL registerInvoice accepts', async () => {
    const r = await callerFor(A).scans.upload({ contentBase64: PNG.toString('base64'), mimeType: 'image/png' });
    expect(r.signedUrl).toMatch(/\/scans\/scan-[a-z0-9]+-[a-f0-9]{8}\/file$/);
    expect(scanIdFromLocalUrl(r.signedUrl!)).toBe(r.invoiceId);
    const stored = await readLocalScan(A.restaurantId, r.invoiceId);
    expect(stored?.bytes.equals(PNG)).toBe(true);
    expect(stored?.meta.mimeType).toBe('image/png');
  });

  it('is tenant-scoped: B cannot read A\'s scan', async () => {
    const r = await callerFor(A).scans.upload({ contentBase64: PNG.toString('base64'), mimeType: 'image/png' });
    expect(await readLocalScan(B.restaurantId, r.invoiceId)).toBeNull();
  });

  it('M8: the same clientUploadId twice yields ONE stored scan with the same id', async () => {
    const clientUploadId = '6f1c2a7e-1d2b-4c3d-8e9f-0a1b2c3d4e5f';
    const caller = callerFor(A);
    const input = { contentBase64: PNG.toString('base64'), mimeType: 'image/png', clientUploadId };
    const [a, b] = [await caller.scans.upload(input), await caller.scans.upload(input)];
    expect(a.invoiceId).toBe(b.invoiceId);
    expect(a.signedUrl).toBe(b.signedUrl);
    const files = await readdir(join(dir, A.restaurantId));
    expect(files.filter((f) => f.endsWith('.png'))).toHaveLength(1);
    // Different tenant + same client id → different scan id (no cross-tenant collision).
    expect(deterministicScanId(B.restaurantId, clientUploadId)).not.toBe(a.invoiceId);
  });

  it('production without Supabase still fails loudly (no silent local fallback)', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    await expect(
      callerFor(A).scans.upload({ contentBase64: PNG.toString('base64'), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
