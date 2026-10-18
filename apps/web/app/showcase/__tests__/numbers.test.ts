import { describe, expect, it } from 'vitest';
import { SHOWCASE_VAT_RATE } from '../_lib/money';
import { mockText } from '../_lib/mockText';
import { invoiceAudits } from '../dashboard/invoices/_mock';
import { supplierProfiles } from '../dashboard/suppliers/[supplierId]/_mock';
import { MOCK_SUPPLIERS, mockReconcile } from '../receiver/_mock';

/**
 * The client clicks through the showcase: the same invoice must carry the same
 * ₪ on every screen. These lock the mocks to one another (not to magic numbers),
 * plus the few headline facts the feed and approvals log quote.
 */
const HEBREW = /[֐-׿]/;
const r2 = (n: number) => Math.round(n * 100) / 100;
const byNumber = (n: string) => invoiceAudits().find((r) => r.invoiceNumber === n)!;

describe('showcase numbers agree across screens', () => {
  it('every audit header is derived from its lines (ex-VAT)', () => {
    for (const r of invoiceAudits()) {
      const billed = r2(r.lines.reduce((s, l) => s + (l.invoiceQty ?? 0) * (l.invoiceUnitPrice ?? 0), 0));
      expect(r.totalInvoiceIls, r.invoiceNumber).toBe(billed);
      expect(r2(r.totalApprovedIls + r.savingsCapturedIls), r.invoiceNumber).toBe(billed);
      if (r.status !== 'blocked') {
        expect(r.savingsCapturedIls, r.invoiceNumber).toBe(r2(r.lines.reduce((s, l) => s + l.variance, 0)));
      }
    }
  });

  it('INV-7821: cherry tomatoes are the ~₪30, +21% exception', () => {
    const inv = byNumber('INV-7821');
    const cherry = inv.lines.find((l) => l.status === 'price_higher')!;
    expect(cherry.variance).toBe(30);
    expect(inv.poNumber).toBe('PO-1234');
    const avi = supplierProfiles()['sup-avi']!;
    const tomato = avi.topProducts.find((p) => p.productId === 'prod-tomato')!;
    expect(Math.round(tomato.trendPct)).toBe(21);
    expect(tomato.currentPrice).toBe(cherry.invoiceUnitPrice);
  });

  it('INV-4882 is ₪3,420 on the invoices page, the supplier page and the receiver', () => {
    const inv = byNumber('INV-4882');
    expect(inv.totalInvoiceIls).toBe(3420);
    expect(inv.savingsCapturedIls).toBe(3420);
    const row = supplierProfiles()['sup-kerem']!.recentInvoices.find((i) => i.invoiceNumber === 'INV-4882')!;
    expect(row.totalIls).toBe(3420);
    expect(MOCK_SUPPLIERS.find((s) => s.supplierId === 'sup-kerem')!.totalEstimated).toBe(3420);
  });

  it('supplier-page rows of audited invoices carry the audit figures', () => {
    for (const p of Object.values(supplierProfiles())) {
      for (const row of p.recentInvoices) {
        const a = invoiceAudits().find((r) => r.invoiceNumber === row.invoiceNumber);
        if (!a) continue;
        expect([row.totalIls, row.approvedIls, row.savingsCapturedIls, row.status], row.invoiceNumber).toEqual([
          a.totalInvoiceIls,
          a.totalApprovedIls,
          a.savingsCapturedIls,
          a.status,
        ]);
      }
    }
  });

  it('receiver PO headers match their own lines', () => {
    for (const s of MOCK_SUPPLIERS) {
      const po = mockReconcile(s.supplierId).lines.filter((l) => l.poQty !== null);
      expect(s.totalLines, s.supplierId).toBe(po.length);
      expect(s.totalEstimated, s.supplierId).toBe(r2(po.reduce((t, l) => t + l.poQty! * (l.poUnitPrice ?? 0), 0)));
    }
  });

  it('the receiver flow shows the same invoice as the invoices page', () => {
    for (const s of MOCK_SUPPLIERS) {
      const r = mockReconcile(s.supplierId);
      const audit = invoiceAudits().find((a) => s.poIds.includes(a.poNumber.toLowerCase()))!;
      expect(r.invoiceMeta.invoiceNumber, s.supplierId).toBe(audit.invoiceNumber);
      const billed = r2(r.lines.reduce((t, l) => t + (l.invoiceQty ?? 0) * (l.invoiceUnitPrice ?? 0), 0));
      expect(billed, s.supplierId).toBe(audit.totalInvoiceIls);
      // The receiver can't know about a duplicate number; every other gap matches.
      if (audit.status !== 'blocked') expect(r.summary.headlineDelta, s.supplierId).toBe(audit.savingsCapturedIls);
      // English names match the rest of the showcase.
      expect(s.supplierNameEn, s.supplierId).toBe(mockText(s.supplierName, 'en'));
      for (const l of r.lines) expect(l.productNameEn, l.productName).toBe(mockText(l.productName, 'en'));
    }
  });

  it('VAT is 18%', () => {
    expect(SHOWCASE_VAT_RATE).toBe(0.18);
  });

  it('every audit note and timeline string has an English twin', () => {
    for (const r of invoiceAudits()) {
      const texts = [
        ...r.lines.flatMap((l) => [l.productName, l.note]),
        ...r.timeline.flatMap((e) => [e.action, e.detail]),
      ].filter((t): t is string => Boolean(t));
      for (const t of texts) expect(mockText(t, 'en'), t).not.toMatch(HEBREW);
    }
  });

  it('every supplier-profile string has an English twin', () => {
    for (const p of Object.values(supplierProfiles())) {
      const texts = [
        p.metadata.name,
        ...p.topProducts.map((x) => x.name),
        ...p.activity.flatMap((a) => [a.title, a.detail]),
      ].filter((t): t is string => Boolean(t));
      for (const t of texts) expect(mockText(t, 'en'), t).not.toMatch(HEBREW);
    }
  });
});
