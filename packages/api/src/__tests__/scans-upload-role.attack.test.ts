import { createDb, testDbUrl } from '@restomatch/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from '../index';
import type { AppContext, Session } from '../context';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * scans.upload role gate (IA warden review). The procedure is receiverProcedure:
 * only the roles that photograph invoices at the dock (owner / manager /
 * receiver — the same gate as receiving.registerInvoice) may store a scan. A
 * chef or a bookkeeper gets FORBIDDEN and stores no orphan private scan or
 * invoice_scans row. Tenant isolation of the upload itself stays covered by the
 * base COVERAGE entry + storage.attack.test.ts.
 */
const db = createDb(testDbUrl());
let A: Tenant;

function callerWithRole(tenant: Tenant, role: Session['role']) {
  const session: Session = { userId: tenant.ownerUserId, restaurantId: tenant.restaurantId, role };
  const ctx: AppContext = { db, session };
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await resetDb(db);
  A = await seedTenant(db, 'A');
});

afterAll(async () => {
  await resetDb(db);
});

describe('role denial: scans.upload — only the roles that photograph invoices', () => {
  for (const role of ['chef', 'bookkeeper'] as const) {
    it(`scans.upload → FORBIDDEN for ${role}`, async () => {
      await expect(
        callerWithRole(A, role).scans.upload({ contentBase64: 'AAAA', mimeType: 'image/png' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  }

  it('owner / manager / receiver pass the role gate (an unsupported mime → BAD_REQUEST, not FORBIDDEN)', async () => {
    for (const role of ['owner', 'manager', 'receiver'] as const) {
      await expect(
        callerWithRole(A, role).scans.upload({ contentBase64: 'AAAA', mimeType: 'text/plain' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
  });
});
