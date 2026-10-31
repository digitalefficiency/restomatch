import { describe, expect, it } from 'vitest';
import { displayName } from '../displayName';
import { entitlementCauseOf, featureLabel } from '../entitlement';
import { friendlyError, trpcErrorCode } from '../errors';
import { createSingleFlight } from '../singleFlight';
import { createTranslator } from '../../i18n/translate';
import { components } from '../../i18n/messages/components';

describe('displayName', () => {
  it('Hebrew always shows the Hebrew name', () => {
    expect(displayName('עגבניה', 'Tomato', 'he')).toEqual({ primary: 'עגבניה', secondary: null });
  });
  it('English shows name_en with the Hebrew original as secondary; falls back to Hebrew', () => {
    expect(displayName('עגבניה', 'Tomato', 'en')).toEqual({ primary: 'Tomato', secondary: 'עגבניה' });
    expect(displayName('עגבניה', '  ', 'en')).toEqual({ primary: 'עגבניה', secondary: null });
    expect(displayName('Coca-Cola', 'Coca-Cola', 'en')).toEqual({ primary: 'Coca-Cola', secondary: null });
  });
});

describe('entitlements', () => {
  it('reads the cause server-side and the message token client-side', () => {
    expect(entitlementCauseOf({ cause: { code: 'ENTITLEMENT_REQUIRED', feature: 'accounting_export' } })).toMatchObject({
      feature: 'accounting_export',
    });
    // TRPCClientError: no cause on the wire, only the message.
    expect(entitlementCauseOf(new Error('ENTITLEMENT_REQUIRED:whatsapp_alerts'))).toMatchObject({
      feature: 'whatsapp_alerts',
    });
    expect(entitlementCauseOf(new Error('nope'))).toBeNull();
  });
  it('labels features per locale', () => {
    expect(featureLabel('accounting_export', 'en')).toBe('Accounting export');
    expect(featureLabel('accounting_export')).toBe('ייצוא להנהלת חשבונות');
    expect(featureLabel('unknown_feature', 'en')).toBe('unknown_feature');
  });
});

describe('friendlyError', () => {
  const t = createTranslator('en', components);
  it('never surfaces the raw (Hebrew / zod) server message', () => {
    const err = Object.assign(new Error('[{"code":"too_small"}]'), { data: { code: 'BAD_REQUEST' } });
    expect(trpcErrorCode(err)).toBe('BAD_REQUEST');
    expect(friendlyError(err, t)).toBe('Some fields are invalid. Please check and try again.');
  });
  it('prefers per-screen overrides, then generic per code', () => {
    const conflict = Object.assign(new Error('כבר קיים'), { data: { code: 'CONFLICT' } });
    expect(friendlyError(conflict, t, { CONFLICT: 'Duplicate SKU' })).toBe('Duplicate SKU');
    expect(friendlyError(conflict, t)).toBe('Something went wrong. Please try again.');
    expect(friendlyError(new TypeError('Failed to fetch'), t)).toBe(
      'Can’t reach the server. Check your connection and try again.',
    );
  });
});

describe('createSingleFlight (double-submit guard)', () => {
  it('drops a second call while the first is in flight, then allows the next', async () => {
    const run = createSingleFlight();
    let calls = 0;
    let resolve!: () => void;
    const fn = () => {
      calls++;
      return new Promise<void>((r) => (resolve = r));
    };
    expect(run(fn)).toBe(true);
    expect(run(fn)).toBe(false); // the double-click's second click
    expect(calls).toBe(1);
    resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(run(fn)).toBe(true);
    expect(calls).toBe(2);
  });

  it('releases after a rejection (errors are shown from the mutation state)', async () => {
    const run = createSingleFlight();
    run(() => Promise.reject(new Error('CONFLICT')));
    await new Promise((r) => setTimeout(r, 0));
    let ran = false;
    run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('releases when the callback throws synchronously', () => {
    const run = createSingleFlight();
    run(() => {
      throw new Error('boom');
    });
    expect(run(async () => {})).toBe(true);
  });
});
