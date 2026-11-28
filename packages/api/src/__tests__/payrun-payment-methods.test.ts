import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS } from '../lifecycle/machines';
import { PAY_RUN_PAYMENT_METHODS, paymentMethodInput } from '../routers/payRun';

/**
 * W2-03 · mark-paid's method enum must equal G-05's PAYMENT_METHODS (= H-03's signed 0072
 * `invoices_payment_method_check`), or the write is refused (BAD_REQUEST / 23514) the moment it lands.
 */
describe('pay-run payment methods', () => {
  it('equal lifecycle PAYMENT_METHODS (no drift)', () => {
    expect([...PAY_RUN_PAYMENT_METHODS].sort()).toEqual([...PAYMENT_METHODS].sort());
  });
  it("normalise the legacy 'credit_card' to 'card'", () => {
    expect(paymentMethodInput.parse('credit_card')).toBe('card');
    expect(paymentMethodInput.parse('offset')).toBe('offset');
  });
  it('refuse anything else', () => {
    expect(paymentMethodInput.safeParse('wire').success).toBe(false);
    expect(paymentMethodInput.safeParse(null).success).toBe(false);
  });
});
