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
    expect(localizeActivity({ eventType: 'invoice_received', title: 'חשבונית התקבלה', detail: 'ירקות השרון · ₪1027 כולל מע״מ' }, 'en').detail).toBe(
      'ירקות השרון · ₪1,027 incl. VAT',
    );
    expect(localizeActivity({ eventType: 'invoice_matched', title: 'x', detail: 'מאפיית ברנר · תואמת להזמנה ולקבלה' }, 'en').detail).toBe(
      'מאפיית ברנר · matches the order and the delivery',
    );
    expect(
      localizeActivity({ eventType: 'invoice_received', title: 'x', detail: 'מחלבות הגליל · ממתינה להתאמה מול תעודות המשלוח של החודש' }, 'en').detail,
    ).toBe("מחלבות הגליל · waiting to be matched against this month's delivery notes");
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

describe('localizeActivity — structured metadata (S3 writers + demo seed)', () => {
  const he = { title: 'חשבונית HK-24108 הותאמה', detail: 'קצביית הכרם · 2 חריגות · הפסד פוטנציאלי ₪154' };

  it('renders invoice_matched from metadata in English (supplier in English)', () => {
    const out = localizeActivity(
      {
        eventType: 'invoice_matched',
        ...he,
        metadata: {
          invoiceNumber: 'HK-24108',
          supplierName: 'קצביית הכרם',
          supplierNameEn: 'HaKerem Butchery',
          discrepancyCount: 2,
          potentialLossIls: 153.52,
        },
      },
      'en',
    );
    expect(out.title).toBe('Invoice HK-24108 matched');
    expect(out.detail).toBe('HaKerem Butchery · 2 discrepancies · potential loss ₪154');
  });

  it('singular discrepancy', () => {
    const out = localizeActivity(
      { eventType: 'invoice_matched', ...he, metadata: { invoiceNumber: 'ST-1', supplierNameEn: 'Steinberg', discrepancyCount: 1, potentialLossIls: 104.8 } },
      'en',
    );
    expect(out.detail).toBe('Steinberg · 1 discrepancy · potential loss ₪105');
  });

  it('a clean match says it matches the order', () => {
    const out = localizeActivity(
      { eventType: 'invoice_matched', ...he, metadata: { invoiceNumber: 'X-1', supplierNameEn: 'Sharon', discrepancyCount: 0 } },
      'en',
    );
    expect(out.detail).toBe('Sharon · matches the order and the goods receipt');
  });

  it('invoice_received and consolidated invoices render without Hebrew', () => {
    const rec = localizeActivity(
      { eventType: 'invoice_received', title: 'x', detail: 'y', metadata: { invoiceNumber: 'BR-1', supplierNameEn: 'Brenner', totalInclVatIls: 618.49 } },
      'en',
    );
    expect(rec).toEqual({ title: 'Invoice BR-1 received', detail: 'Brenner · ₪618 incl. VAT' });
    const cons = localizeActivity(
      { eventType: 'invoice_received', title: 'x', detail: 'y', metadata: { consolidated: true, invoiceNumber: 'BR-R-1', supplierNameEn: 'Brenner' } },
      'en',
    );
    expect(cons.title).toBe('Consolidated invoice BR-R-1 received');
    expect(cons.detail).not.toMatch(/[֐-׿]/);
  });

  it('Hebrew always shows the stored text; rows without metadata fall back to parsing', () => {
    expect(localizeActivity({ eventType: 'invoice_matched', ...he, metadata: { invoiceNumber: 'HK-24108' } }, 'he')).toEqual(he);
    expect(localizeActivity({ eventType: 'invoice_matched', ...he, metadata: {} }, 'en').title).toBe('Invoice HK-24108 matched');
  });
});
