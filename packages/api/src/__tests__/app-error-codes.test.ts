import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDb, testDbUrl } from '@restomatch/db';
import { appRouter } from '../index';
import type { AppContext } from '../context';
import { QuotaExceededError } from '../entitlements';
import { APP_ERROR_CODES, appError, resolveAppError } from '../errors';
import { resetDb, seedTenant, type Tenant } from './fixtures';

/**
 * Stable error codes: every known domain error exposes `data.appCode` to tRPC
 * clients (errorFormatter) so the web translates by code, not by Hebrew text.
 */
describe('resolveAppError', () => {
  it('reads an explicit appError cause (+ params)', () => {
    const err = appError('BAD_REQUEST', 'team.lastOwner', 'חייב להישאר לפחות בעלים אחד.', { n: 1 });
    expect(err.message).toBe('חייב להישאר לפחות בעלים אחד.');
    expect(resolveAppError(err)).toEqual({ appCode: 'team.lastOwner', appParams: { n: 1 } });
  });

  it('maps quota errors: inactive subscription vs exceeded cap (with the limit)', () => {
    const inactive = new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      cause: new QuotaExceededError('המנוי אינו פעיל — נדרש חידוש', 'ocr_scans', 0),
    });
    expect(resolveAppError(inactive)).toEqual({ appCode: 'subscription.inactive' });
    const capped = new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      cause: new QuotaExceededError('חרגתם ממכסת הסריקות החודשית (50).', 'ocr_scans', 50),
    });
    expect(resolveAppError(capped)).toEqual({ appCode: 'quota.exceeded', appParams: { limit: 50 } });
  });

  it('maps ENTITLEMENT_REQUIRED:<feature>, role and auth failures', () => {
    expect(
      resolveAppError(new TRPCError({ code: 'FORBIDDEN', message: 'ENTITLEMENT_REQUIRED:accounting_export' })),
    ).toEqual({ appCode: 'entitlement.required', appParams: { feature: 'accounting_export' } });
    expect(
      resolveAppError(new TRPCError({ code: 'FORBIDDEN', message: 'Required role: owner, got: chef' })),
    ).toEqual({ appCode: 'auth.forbidden' });
    expect(resolveAppError(new TRPCError({ code: 'UNAUTHORIZED' }))).toEqual({ appCode: 'auth.unauthorized' });
  });

  it('reads params.appCode from a zod issue, else input.invalid', () => {
    const schema = z.string().refine(() => false, { message: 'אזור זמן לא תקין', params: { appCode: 'settings.invalidTimezone' } });
    const declared = schema.safeParse('x');
    const plain = z.string().min(5).safeParse('x');
    expect(
      resolveAppError(new TRPCError({ code: 'BAD_REQUEST', cause: declared.error })),
    ).toEqual({ appCode: 'settings.invalidTimezone' });
    expect(resolveAppError(new TRPCError({ code: 'BAD_REQUEST', cause: plain.error }))).toEqual({
      appCode: 'input.invalid',
    });
  });

  it('returns null for an unknown error (clients fall back to the message)', () => {
    expect(resolveAppError(new TRPCError({ code: 'NOT_FOUND', message: 'x' }))).toBeNull();
    expect(new Set(APP_ERROR_CODES).size).toBe(APP_ERROR_CODES.length);
  });
});

describe('errorFormatter over HTTP (the shape real clients see)', () => {
  const db = createDb(testDbUrl());
  let A: Tenant;

  beforeAll(async () => {
    await resetDb(db);
    A = await seedTenant(db, 'A');
  });
  afterAll(async () => {
    await resetDb(db);
  });

  async function call(path: string, input: unknown, role: 'owner' | 'chef' = 'owner') {
    const ctx: AppContext = {
      db,
      session: { userId: A.ownerUserId, restaurantId: A.restaurantId, role },
    };
    const res = await fetchRequestHandler({
      endpoint: '/api/trpc',
      router: appRouter,
      createContext: () => ctx,
      req: new Request(`http://test/api/trpc/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: input }),
      }),
    });
    return (await res.json()) as { error?: { json: { message: string; data: Record<string, unknown> } } };
  }

  it('team.updateMemberRole on the last owner → data.appCode team.lastOwner (message unchanged)', async () => {
    const body = await call('team.updateMemberRole', { userId: A.ownerUserId, role: 'receiver' });
    expect(body.error?.json.data.appCode).toBe('team.lastOwner');
    expect(body.error?.json.message).toBe('חייב להישאר לפחות בעלים אחד.');
  });

  it('settings.updateProfile with a bad timezone → settings.invalidTimezone', async () => {
    const body = await call('settings.updateProfile', { timezone: 'Not/AZone' });
    expect(body.error?.json.data.appCode).toBe('settings.invalidTimezone');
  });

  it('a role failure → auth.forbidden; an uncoded error → appCode null', async () => {
    const forbidden = await call('team.invite', { email: 'x@y.test', role: 'receiver' }, 'chef');
    expect(forbidden.error?.json.data.appCode).toBe('auth.forbidden');
    const notAdmin = await call('admin.setMemberRole', {
      restaurantId: A.restaurantId,
      userId: A.ownerUserId,
      role: 'owner',
    });
    expect(notAdmin.error?.json.data.appCode).toBe('auth.forbidden');
    // A transport-level error (POST to a query) has no domain code.
    const uncoded = await call('team.list', {});
    expect(uncoded.error?.json.data.code).toBe('METHOD_NOT_SUPPORTED');
    expect(uncoded.error?.json.data.appCode).toBeNull();
  });
});
