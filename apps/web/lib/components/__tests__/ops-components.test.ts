import { describe, expect, it } from 'vitest';
import { localizeActivity } from '../activityText';
import { displayName } from '../displayName';
import { entitlementCauseOf, featureLabel } from '../entitlement';
import { friendlyError, trpcErrorCode } from '../errors';
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

describe('localizeActivity', () => {
  const seedRow = {
    eventType: 'invoice_matched',
    title: 'חשבונית 2026-1000 הותאמה',
    detail: 'ירקני אבי · 9 חריגות · הפסד פוטנציאלי ₪3571',
  };
  it('leaves Hebrew untouched', () => {
    expect(localizeActivity(seedRow, 'he')).toEqual({ title: seedRow.title, detail: seedRow.detail });
  });
  it('rebuilds known templates in English (supplier name kept)', () => {
    const out = localizeActivity(seedRow, 'en');
    expect(out.title).toBe('Invoice 2026-1000 matched');
    expect(out.detail).toBe('ירקני אבי · 9 discrepancies · potential loss ₪3,571');
  });
  it('maps the API titles and falls back to the event label', () => {
    expect(localizeActivity({ eventType: 'discrepancy_approved', title: 'חריגה אושרה', detail: 'חיסכון ₪1,200' }, 'en')).toEqual({
      title: 'Discrepancy approved',
      detail: 'saved ₪1,200',
    });
    expect(localizeActivity({ eventType: 'mystery', title: 'משהו', detail: null }, 'en').title).toBe('Update');
    expect(localizeActivity({ eventType: 'sync_completed', title: 'Synced 3 orders', detail: null }, 'en').title).toBe(
      'Synced 3 orders',
    );
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
