import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { entitlementCauseOf } from '@/lib/components/entitlement';
import { settle } from '../[id]/leak-card-reads';

/** G-16 (money-swallow): a failed read is "unavailable", never ₪0 or an empty list. */
describe('W2-11 · supplier leak card reads (G-16)', () => {
  const isGated = (err: unknown) => entitlementCauseOf(err) !== null;

  it('a successful read keeps its value, including a real 0', async () => {
    expect(await settle(Promise.resolve(0))).toEqual({ state: 'ok', value: 0 });
    expect(await settle(Promise.resolve([]))).toEqual({ state: 'ok', value: [] });
  });

  it('a failed letter read is unavailable — it no longer becomes ₪0', async () => {
    const r = await settle(Promise.reject(new Error('recovery.list timed out')));
    expect(r).toEqual({ state: 'unavailable' });
    expect(r.state === 'ok' ? r.value : null).toBeNull();
  });

  it('only an entitlement refusal reads as gated; any other scorecard failure is unavailable', async () => {
    const gated = new TRPCError({
      code: 'FORBIDDEN',
      message: 'plan',
      cause: Object.assign(new Error('entitlement'), { code: 'ENTITLEMENT_REQUIRED', feature: 'advanced_analytics' }),
    });
    const gatedRead = await settle(Promise.reject(gated), isGated);
    const brokenRead = await settle(Promise.reject(new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'db down' })), isGated);
    expect(brokenRead).toEqual({ state: 'unavailable' });
    expect(gatedRead).toEqual({ state: 'gated' });
  });
});
