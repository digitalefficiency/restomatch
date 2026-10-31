import { describe, expect, it } from 'vitest';
import { stripIsolates } from '../../i18n/translate';
import { activityHref, groupActivity, localizeActivity } from '../activityText';

const HEBREW = /[֐-׿]/;

/* ──────────────────────────────────────────────────────────────────────────────
 * Moved 1:1 from ops-components.test.ts (W2-13, orchestrator-approved). Every old
 * assertion is kept; where it fed stored Hebrew text to the deleted reverse parser,
 * it is re-expressed as the same facts in metadata. Wording changes are the glossary's
 * (potential loss → "in discrepancies", findings → discrepancies, approved → claimed).
 * ────────────────────────────────────────────────────────────────────────────── */
describe('localizeActivity (moved from ops-components)', () => {
  const seedRow = {
    eventType: 'invoice_matched',
    title: 'חשבונית 2026-1000 הותאמה',
    detail: 'ירקני אבי · 9 חריגות · הפסד פוטנציאלי ₪3571',
  };
  it('leaves Hebrew untouched (legacy row)', () => {
    expect(localizeActivity(seedRow, 'he')).toEqual({ title: seedRow.title, detail: seedRow.detail });
  });
  it('rebuilds known templates in English from metadata (supplier name kept)', () => {
    const out = localizeActivity(
      { ...seedRow, metadata: { invoiceNumber: '2026-1000', supplierName: 'ירקני אבי', leakCount: 9, leakIls: 3571, poMatched: true } },
      'en',
    );
    expect(out.title).toBe('Invoice 2026-1000 matched');
    expect(out.detail).toBe('ירקני אבי · 9 discrepancies · ₪3,571 in discrepancies');
  });
  it('maps the event titles and falls back to the event label', () => {
    expect(
      localizeActivity({ eventType: 'discrepancy_approved', title: 'חריגה אושרה', detail: 'חיסכון ₪1,200', metadata: { amountAgorot: 120000 } }, 'en'),
    ).toEqual({ title: 'Claimed from supplier', detail: 'claimed ₪1,200' });
    expect(localizeActivity({ eventType: 'mystery', title: 'משהו', detail: null }, 'en').title).toBe('Update');
    expect(
      localizeActivity(
        { eventType: 'invoice_received', title: 'x', detail: 'y', metadata: { invoiceNumber: 'A-1', supplierName: 'ירקות השרון', totalInclVatIls: 1027 } },
        'en',
      ).detail,
    ).toBe('ירקות השרון · ₪1,027 incl. VAT');
    expect(
      localizeActivity(
        { eventType: 'invoice_matched', title: 'x', detail: 'y', metadata: { invoiceNumber: 'B-1', supplierName: 'מאפיית ברנר', poMatched: true, leakCount: 0, reviewCount: 0 } },
        'en',
      ).detail,
    ).toBe('מאפיית ברנר · matches the order and the goods receipt');
    expect(
      localizeActivity(
        { eventType: 'invoice_received', title: 'x', detail: 'y', metadata: { consolidated: true, invoiceNumber: 'C-1', supplierName: 'מחלבות הגליל' } },
        'en',
      ).detail,
    ).toBe("מחלבות הגליל · waiting to be matched against this week's delivery notes");
    // A stored title is never shown in English any more: the event label is.
    expect(localizeActivity({ eventType: 'sync_completed', title: 'Synced 3 orders', detail: null }, 'en').title).toBe('Sync completed');
  });
});

describe('localizeActivity: structured metadata (moved from ops-components)', () => {
  const he = { title: 'חשבונית HK-24108 הותאמה', detail: 'קצביית הכרם · 2 חריגות · הפסד פוטנציאלי ₪154' };

  it('renders invoice_matched from metadata in English (supplier in English)', () => {
    const out = localizeActivity(
      {
        eventType: 'invoice_matched',
        ...he,
        metadata: { invoiceNumber: 'HK-24108', supplierName: 'קצביית הכרם', supplierNameEn: 'HaKerem Butchery', discrepancyCount: 2, potentialLossIls: 153.52 },
      },
      'en',
    );
    expect(out.title).toBe('Invoice HK-24108 matched');
    expect(out.detail).toBe('HaKerem Butchery · 2 discrepancies · ₪154 in discrepancies');
  });

  it('English never shows Hebrew sentences from a row without metadata (no parsing)', () => {
    const out = localizeActivity({ eventType: 'invoice_matched', title: 'x', detail: 'משקאות שטיינברג · חריגה אחת · הפסד פוטנציאלי ₪105' }, 'en');
    expect(out).toEqual({ title: 'Invoice matched', detail: null });
    const pending = localizeActivity(
      { eventType: 'invoice_matched', title: 'x', detail: 'ירקות השרון · ממתינה לשיוך להזמנה', metadata: { supplierNameEn: 'Sharon' } },
      'en',
    );
    expect(pending).toEqual({ title: 'Invoice matched', detail: 'Sharon' });
  });

  it('metadata: the hero-rule leak (leakCount / leakIls / pendingLink) wins over the engine totals', () => {
    const base = { invoiceNumber: 'X-1', supplierNameEn: 'Sharon', discrepancyCount: 3, potentialLossIls: 1273 };
    const pending = localizeActivity({ eventType: 'invoice_matched', ...he, metadata: { ...base, leakCount: 0, leakIls: 0, pendingLink: true } }, 'en');
    expect(pending.detail).toBe('Sharon · waiting to be linked to an order');
    const clean = localizeActivity({ eventType: 'invoice_matched', ...he, metadata: { ...base, leakCount: 0, leakIls: 0, pendingLink: false } }, 'en');
    expect(clean.detail).toBe('Sharon · matches the order and the goods receipt');
    const one = localizeActivity({ eventType: 'invoice_matched', ...he, metadata: { ...base, leakCount: 1, leakIls: 104.8, pendingLink: false } }, 'en');
    expect(one.detail).toBe('Sharon · 1 discrepancy · ₪105 in discrepancies');
  });

  it('metadata with poMatched: worded from the findings (no PO + gaps, to review, no order linked)', () => {
    const base = { invoiceNumber: 'X-1', supplierNameEn: 'Sharon', discrepancyCount: 2, potentialLossIls: 1285 };
    const pendingLoss = localizeActivity(
      { eventType: 'invoice_matched', ...he, metadata: { ...base, poMatched: false, pendingLink: true, leakCount: 1, leakIls: 12.6, reviewCount: 0 } },
      'en',
    );
    expect(pendingLoss.detail).toBe('Sharon · waiting to be linked to an order · 1 discrepancy · ₪13 in discrepancies');
    const review = localizeActivity(
      { eventType: 'invoice_matched', ...he, metadata: { ...base, poMatched: true, pendingLink: false, leakCount: 0, leakIls: 0, reviewCount: 2 } },
      'en',
    );
    expect(review.detail).toBe('Sharon · 2 discrepancies to review');
    const noPo = localizeActivity(
      { eventType: 'invoice_matched', ...he, metadata: { ...base, poMatched: false, pendingLink: false, leakCount: 0, leakIls: 0, reviewCount: 0 } },
      'en',
    );
    expect(noPo.detail).toBe('Sharon · no order linked');
    expect(
      localizeActivity(
        { eventType: 'invoice_matched', title: 'x', detail: 'y', metadata: { invoiceNumber: 'S-1', supplierName: 'ירקות השרון', poMatched: true, leakCount: 0, reviewCount: 1 } },
        'en',
      ).detail,
    ).toBe('ירקות השרון · 1 discrepancy to review');
  });

  it('singular discrepancy', () => {
    const out = localizeActivity(
      { eventType: 'invoice_matched', ...he, metadata: { invoiceNumber: 'ST-1', supplierNameEn: 'Steinberg', discrepancyCount: 1, potentialLossIls: 104.8 } },
      'en',
    );
    expect(out.detail).toBe('Steinberg · 1 discrepancy · ₪105 in discrepancies');
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
    expect(cons.detail).not.toMatch(HEBREW);
  });

  it('Hebrew shows the stored text for a legacy row; English uses the event label when metadata has no number', () => {
    expect(localizeActivity({ eventType: 'invoice_matched', ...he, metadata: { invoiceNumber: 'HK-24108' } }, 'he')).toEqual(he);
    expect(localizeActivity({ eventType: 'invoice_matched', ...he, metadata: {} }, 'en').title).toBe('Invoice matched');
  });
});

/* ── new (W2-13) ─────────────────────────────────────────────────────────────── */
describe('activity feed v2 (W2-13)', () => {
  const v2 = {
    id: 'm1',
    eventType: 'invoice_matched',
    title: 'invoice_matched:HK-1',
    detail: null,
    metadata: {
      v: 2,
      invoiceId: 'inv-1',
      invoiceNumber: 'HK-1',
      supplierName: 'קצביית הכרם',
      supplierNameEn: 'HaKerem Butchery',
      poMatched: true,
      pendingLink: false,
      leakCount: 2,
      leakAgorot: 15352,
      reviewCount: 0,
    },
  };

  it('renders v2 metadata in Hebrew from the reviewed copy (never the machine title)', () => {
    const out = localizeActivity(v2, 'he');
    expect(stripIsolates(out.title)).toBe('חשבונית HK-1 הותאמה'); // "HK-1" is isolated (Latin + digits)
    expect(out.detail).toContain('קצביית הכרם');
    expect(out.detail).toContain('שני פערים');
    expect(out.detail).toContain('בפערים');
    expect(out.detail).not.toMatch(/חריג|הפסד|חיסכון/);
  });

  it('renders v2 metadata in English, ₪ from agorot through formatIls', () => {
    expect(localizeActivity(v2, 'en')).toEqual({
      title: 'Invoice HK-1 matched',
      detail: 'HaKerem Butchery · 2 discrepancies · ₪154 in discrepancies',
    });
  });

  it('no ₪ part when the metadata carries no ₪ (receiver/chef redaction, G-07)', () => {
    const { leakAgorot: _drop, ...rest } = v2.metadata;
    for (const locale of ['he', 'en'] as const) {
      const out = localizeActivity({ ...v2, metadata: rest }, locale);
      expect(out.detail).not.toMatch(/₪/);
      expect(out.detail).toBeTruthy();
    }
  });

  it('never parses stored Hebrew: a legacy row in English shows the label plus the supplier', () => {
    const legacy = { eventType: 'invoice_matched', title: 'חשבונית 5 הותאמה', detail: 'תנובה · 3 חריגות · הפסד פוטנציאלי ₪99', metadata: { supplierName: 'תנובה' } };
    expect(localizeActivity(legacy, 'en')).toEqual({ title: 'Invoice matched', detail: 'תנובה' });
    expect(localizeActivity(legacy, 'he')).toEqual({ title: legacy.title, detail: legacy.detail });
  });

  it('groups received + matched (and a re-match) of one invoice into the newest row; links it', () => {
    const rows = [
      v2,
      { id: 'r1', eventType: 'invoice_received', title: 't', detail: null, metadata: { v: 2, invoiceId: 'inv-1', invoiceNumber: 'HK-1' } },
      { id: 'm0', eventType: 'invoice_matched', title: 't', detail: null, metadata: { v: 2, invoiceId: 'inv-1', invoiceNumber: 'HK-1' } },
      { id: 'r2', eventType: 'invoice_received', title: 't', detail: null, metadata: { v: 2, invoiceId: 'inv-2', invoiceNumber: 'X-2' } },
      { id: 'd1', eventType: 'discrepancy_approved', title: 't', detail: null, metadata: { invoiceId: 'inv-1' } },
      { id: 'n1', eventType: 'sync_completed', title: 't', detail: null },
    ];
    expect(groupActivity(rows).map((r) => r.id)).toEqual(['m1', 'r2', 'd1', 'n1']);
    expect(activityHref(v2)).toBe('/dashboard/invoices/inv-1');
    expect(activityHref({ eventType: 'sync_completed', title: 't', detail: null })).toBeNull();
  });
});
