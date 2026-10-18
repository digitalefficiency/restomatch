import { describe, expect, it } from 'vitest';
import { buildSearchOptions } from '../searchOptions';
import {
  emptyForm,
  matchesSupplierFilter,
  parsePaymentTerms,
  scheduleToForm,
  toCreateInput,
  toUpdatePatch,
  validateSupplierForm,
  scheduleRowProblem,
} from '../suppliers/form-logic';
import {
  addOrMerge,
  lineLabel,
  lineTotalIls,
  linesValid,
  orderTotalIls,
  parsePositive,
  parsePrice,
} from '../orders/order-logic';
import { chunk, namesBatch, pendingNames, productPatch } from '../products/product-logic';
import { presetRange, rangeError, withBom } from '../exports/range';
import { catalogErrorKey, decodeCsvBytes, sampleCatalogCsv } from '../catalog/import/file-logic';

describe('supplier form', () => {
  const filled = { ...emptyForm, name: ' ירקות השרון ', nameEn: ' Sharon ', contactEmail: 'a@b.co' };

  it('create omits empty optionals (create schema rejects null)', () => {
    expect(toCreateInput({ ...emptyForm, name: 'X' })).toEqual({
      name: 'X',
      nameEn: undefined,
      businessId: undefined,
      contactEmail: undefined,
      contactWhatsapp: undefined,
      paymentTerms: undefined,
    });
    expect(toCreateInput(filled)).toMatchObject({ name: 'ירקות השרון', nameEn: 'Sharon' });
  });

  it('update sends null for cleared fields so they really clear (regression)', () => {
    const patch = toUpdatePatch({ ...emptyForm, name: 'X' });
    expect(patch).toMatchObject({
      nameEn: null,
      businessId: null,
      contactEmail: null,
      contactWhatsapp: null,
      paymentTerms: null,
      deliverySchedule: null,
    });
  });

  it('round-trips the delivery grid', () => {
    const schedule = scheduleToForm({ sun: ['07:30'], wed: ['09:00', '14:00'] });
    expect(schedule).toEqual({ sun: '07:30', wed: '09:00' });
    expect(toUpdatePatch({ ...emptyForm, name: 'X', schedule }).deliverySchedule).toEqual({
      sun: ['07:30'],
      wed: ['09:00'],
    });
  });

  it('validates name + email like the router', () => {
    expect(validateSupplierForm(emptyForm)).toEqual(['nameRequired']);
    expect(validateSupplierForm({ ...emptyForm, name: 'X', contactEmail: 'nope' })).toEqual(['emailInvalid']);
    expect(validateSupplierForm(filled)).toEqual([]);
  });

  it('filters by Hebrew/English name, company id and email', () => {
    const s = { name: 'תנובה', nameEn: 'Tnuva', businessId: '514000001', contactEmail: 'orders@tnuva.co.il' };
    expect(matchesSupplierFilter(s, 'tnu')).toBe(true);
    expect(matchesSupplierFilter(s, 'תנו')).toBe(true);
    expect(matchesSupplierFilter(s, '5140')).toBe(true);
    expect(matchesSupplierFilter(s, 'zzz')).toBe(false);
    expect(matchesSupplierFilter(s, '  ')).toBe(true);
  });
});

describe('order logic', () => {
  it('parses quantities and prices strictly', () => {
    expect(parsePositive('2.5')).toBe(2.5);
    expect(parsePositive('2,5')).toBe(2.5);
    expect(parsePositive('0')).toBeNull();
    expect(parsePositive('-1')).toBeNull();
    expect(parsePositive('abc')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('12.90')).toBe(12.9);
    expect(parsePrice('-3')).toBe('invalid');
  });

  it('merges a repeated catalog pick into one line', () => {
    let n = 0;
    const key = () => `k${++n}`;
    type L = { key: string; productId?: string; rawDescription: string; qty: number };
    let res = addOrMerge<L>([], { productId: 'p1', rawDescription: 'עגבניה', qty: 1 }, key);
    res = addOrMerge(res.lines, { productId: 'p1', rawDescription: 'עגבניה', qty: 1 }, key);
    expect(res.merged).toBe(true);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]!.qty).toBe(2);
    res = addOrMerge(res.lines, { productId: 'p2', rawDescription: 'מלפפון', qty: 1 }, key);
    expect(res.lines).toHaveLength(2);
  });

  it('blocks qty 0 / empty free-text lines', () => {
    expect(linesValid([])).toBe(false);
    expect(linesValid([{ rawDescription: 'x', qty: 0, unit: 'kg' }])).toBe(false);
    expect(linesValid([{ rawDescription: ' ', qty: 1, unit: 'kg' }])).toBe(false);
    expect(linesValid([{ rawDescription: 'x', qty: 1, unit: 'kg' }])).toBe(true);
  });

  it('totals are agorot-exact (no float drift)', () => {
    expect(lineTotalIls(3, 0.335)).toBe(1.01);
    expect(orderTotalIls([{ qty: 1, unitPriceExpected: 0.1 }, { qty: 1, unitPriceExpected: 0.2 }])).toBe(0.3);
    expect(orderTotalIls([{ qty: 2 }])).toBe(0);
  });

  it('labels lines in English with the Hebrew original as secondary', () => {
    const l = { rawDescription: 'עגבניות שרי', productNameEn: 'Cherry tomatoes', rawDescriptionEn: null };
    expect(lineLabel(l, 'he')).toEqual({ primary: 'עגבניות שרי', secondary: null });
    expect(lineLabel(l, 'en')).toEqual({ primary: 'Cherry tomatoes', secondary: 'עגבניות שרי' });
    expect(lineLabel({ rawDescription: 'בצל', rawDescriptionEn: 'Onion' }, 'en').primary).toBe('Onion');
    expect(lineLabel({ rawDescription: 'בצל' }, 'en')).toEqual({ primary: 'בצל', secondary: null });
  });
});

describe('product patch', () => {
  const base = { canonicalName: 'עגבניה', nameEn: '', category: '', defaultUnit: 'ק״ג', barcodeEan: '', supplierId: '' };
  it('sends only changed fields, empty → null', () => {
    expect(productPatch(base, base)).toBeNull();
    expect(productPatch(base, { ...base, nameEn: ' Tomato ' })).toEqual({ nameEn: 'Tomato' });
    expect(productPatch({ ...base, nameEn: 'Tomato' }, base)).toEqual({ nameEn: null });
    expect(productPatch(base, { ...base, supplierId: 's1', defaultUnit: '' })).toEqual({
      supplierId: 's1',
      defaultUnit: null,
    });
  });
});

describe('bulk English names batch', () => {
  const rows = [
    { id: 'a', nameEn: null },
    { id: 'b', nameEn: 'Butter' },
    { id: 'c', nameEn: 'Feta' },
  ];
  it('sends only real changes; blanks clear; reverted edits are dropped', () => {
    expect(namesBatch(rows, {})).toEqual([]);
    expect(
      namesBatch(rows, { a: ' Tomato ', b: '', c: 'Feta ' }),
    ).toEqual([
      { productId: 'a', nameEn: 'Tomato' },
      { productId: 'b', nameEn: null },
    ]);
    expect(namesBatch(rows, { a: '   ' })).toEqual([]);
  });

  it('pendingNames keeps edits to rows the current search hides (regression: lost on save)', () => {
    const edits = {
      bleach: { value: 'Bleach 4L', original: null }, // edited, then the user searched "באגט"
      baguette: { value: 'Baguette ', original: 'Baguete' },
      same: { value: 'Feta', original: 'Feta' },
    };
    expect(pendingNames(edits)).toEqual([
      { productId: 'bleach', nameEn: 'Bleach 4L' },
      { productId: 'baguette', nameEn: 'Baguette' },
    ]);
  });

  it('chunk splits a big save into ≤200-item batches', () => {
    const items = Array.from({ length: 450 }, (_, i) => i);
    expect(chunk(items, 200).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunk([], 200)).toEqual([]);
  });
});

describe('export range', () => {
  it('this month starts on the 1st in Israel time (regression: toISOString gave the 30th/31st)', () => {
    // 1 Oct 2026 00:30 in Israel = 30 Sep 21:30 UTC.
    const now = new Date('2026-09-30T21:30:00Z');
    expect(presetRange('thisMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });
  it('last month / last 30 / this year', () => {
    const now = new Date('2026-03-15T10:00:00Z');
    expect(presetRange('lastMonth', now)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('last30', now)).toEqual({ from: '2026-02-14', to: '2026-03-15' });
    expect(presetRange('thisYear', now)).toEqual({ from: '2026-01-01', to: '2026-03-15' });
    expect(presetRange('lastMonth', new Date('2026-01-10T10:00:00Z'))).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });
  it('validates the range and adds a BOM once', () => {
    expect(rangeError('2026-01-02', '2026-01-01')).toBe('invalid');
    expect(rangeError('', '2026-01-01')).toBe('missing');
    expect(rangeError('2026-01-01', '2026-01-01')).toBeNull();
    expect(withBom('a,b').charCodeAt(0)).toBe(0xfeff);
    expect(withBom(withBom('a,b'))).toBe(withBom('a,b'));
  });
});

describe('catalog import file logic', () => {
  it('decodes UTF-8 (dropping the BOM) and falls back to Windows-1255 for Hebrew Excel CSVs', () => {
    const utf8 = new TextEncoder().encode('﻿תיאור,מחיר');
    expect(decodeCsvBytes(utf8)).toBe('תיאור,מחיר');
    // "תיאור" in Windows-1255: ת=0xFA י=0xE9 א=0xE0 ו=0xE5 ר=0xF8
    const cp1255 = Uint8Array.from([0xfa, 0xe9, 0xe0, 0xe5, 0xf8, 0x2c, 0x31]);
    expect(decodeCsvBytes(cp1255)).toBe('תיאור,1');
  });
  it('maps server error tokens to UI keys', () => {
    expect(catalogErrorKey(new Error('CATALOG_FILE_LEGACY_XLS: x'))).toBe('LEGACY_XLS');
    expect(catalogErrorKey(new Error('CATALOG_FILE_TOO_MANY_ROWS: x'))).toBe('TOO_MANY_ROWS');
    expect(catalogErrorKey(new Error('CATALOG_MAPPING_NAME: x'))).toBe('MAPPING_NAME');
    expect(catalogErrorKey(new Error('boom'))).toBeNull();
  });
  it('ships a sample the auto-mapper understands', () => {
    const csv = sampleCatalogCsv();
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('תיאור');
  });
});

describe('global search options', () => {
  const data = {
    suppliers: [{ id: 's1', name: 'תנובה', nameEn: 'Tnuva' }],
    products: [{ id: 'p1', canonicalName: 'עגבניה', nameEn: null }],
    invoices: [{ id: 'i1', invoiceNumber: null }],
  };
  it('builds links per kind, English names in English', () => {
    const opts = buildSearchOptions(data, { locale: 'en', canSee: () => true, noInvoiceNumber: 'No number' });
    expect(opts.map((o) => o.href)).toEqual([
      '/dashboard/suppliers/s1',
      '/dashboard/products/p1',
      '/dashboard/invoices/i1',
    ]);
    expect(opts[0]).toMatchObject({ label: 'Tnuva', secondary: 'תנובה' });
    expect(opts[1]).toMatchObject({ label: 'עגבניה' });
    expect(opts[2]).toMatchObject({ label: 'No number' });
  });
  it('drops groups the role cannot open (receiver)', () => {
    const opts = buildSearchOptions(data, {
      locale: 'he',
      canSee: (href) => href === '/dashboard/invoices',
      noInvoiceNumber: 'x',
    });
    expect(opts.map((o) => o.kind)).toEqual(['invoice']);
  });
});

describe('supplier payment terms (English display)', () => {
  it('recognises the common Israeli shorthands', () => {
    expect(parsePaymentTerms('שוטף + 30')).toEqual({ kind: 'eom', days: 30 });
    expect(parsePaymentTerms(' שוטף+60 ')).toEqual({ kind: 'eom', days: 60 });
    expect(parsePaymentTerms('שוטף')).toEqual({ kind: 'eom', days: 0 });
    expect(parsePaymentTerms('מזומן')).toEqual({ kind: 'cash' });
  });
  it('leaves free text alone', () => {
    expect(parsePaymentTerms('Net 30')).toBeNull();
    expect(parsePaymentTerms('שוטף + 30 בהעברה')).toBeNull();
    expect(parsePaymentTerms(null)).toBeNull();
  });
});

describe('supplier order schedule', () => {
  it('a cleared cutoff blocks save with its own message (was: generic "invalid fields")', () => {
    expect(scheduleRowProblem({ orderDays: [0], cutoff: '12:00' })).toBeNull();
    expect(scheduleRowProblem({ orderDays: [0], cutoff: '' })).toBe('pickCutoff');
    expect(scheduleRowProblem({ orderDays: [], cutoff: '12:00' })).toBe('pickDay');
  });
});
