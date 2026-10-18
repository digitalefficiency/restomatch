import { describe, expect, it } from 'vitest';
import { GrowBillingProvider, NoopBillingProvider, resolveBillingProvider } from '../index';

describe('NoopBillingProvider', () => {
  it('returns synthetic refs and inert webhooks', async () => {
    const p = new NoopBillingProvider();
    expect(p.id).toBe('noop');
    expect((await p.createCustomer({ billingAccountId: 'acc1', name: 'X' })).customerRef).toContain(
      'acc1',
    );
    const charge = await p.startRecurringCharge({
      billingAccountId: 'acc1',
      planKey: 'pro',
      priceAgorotMonthly: 59000,
      customerRef: 'noop_cust_acc1',
    });
    expect(charge.subscriptionRef).toContain('pro');
    expect((await p.verifyWebhook()).valid).toBe(false);
  });
});

describe('GrowBillingProvider', () => {
  it('throws not-configured without a key', async () => {
    const p = new GrowBillingProvider(undefined);
    await expect(p.createCustomer()).rejects.toThrow(/not configured/);
  });

  it('throws not-wired with a key (skeleton)', async () => {
    const p = new GrowBillingProvider('test-key');
    await expect(p.createCustomer()).rejects.toThrow(/not yet wired/);
  });
});

describe('resolveBillingProvider', () => {
  it('defaults to noop', () => {
    expect(resolveBillingProvider().id).toBe('noop');
  });
  it('returns grow when asked', () => {
    expect(resolveBillingProvider('grow').id).toBe('grow');
  });
});
