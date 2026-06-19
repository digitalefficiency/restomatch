import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudePoParser,
  StubPoParser,
  mapExtractionToNormalized,
  type PoExtraction,
} from '../providers/claudePoVision';

/**
 * Golden fixture — the real order_7158745.pdf (Zestt PO, מיטבר הרצליה ←
 * רמדאן בשרים). 10 lines, meat in יח׳ + poultry in ק״ג, ₪5054 ex-VAT,
 * ₪5963.72 incl 18% VAT. This is the canned extraction Claude would emit.
 */
const ORDER_7158745: PoExtraction = {
  supplierName: 'רמדאן בשרים בע״מ',
  supplierOrderRef: '7158745',
  customerOrderRef: '80234-2239',
  buyerName: 'מיטבר הרצליה',
  deliveryDate: '20/06/2026', // Israeli DD/MM/YYYY — must normalize to ISO
  createdDate: '19/06/2026',
  vatRate: 0.18,
  totalExclVat: 5054,
  totalInclVat: 5963.72,
  lines: [
    { productName: 'טיבון עגלה אנגוס טרי ( 1 יח׳)', sku: '300099', qty: 12, unit: 'יח׳', unitPrice: 84, lineTotal: 1008 },
    { productName: 'ריפ עגלה אנגוס טרי ( 1 יח׳)', sku: '30094', qty: 10, unit: 'יח׳', unitPrice: 95, lineTotal: 950 },
    { productName: 'אסאדו עגלה אנגוס טרי ( 1 יח׳)', sku: '300010', qty: 15, unit: 'יח׳', unitPrice: 36, lineTotal: 540 },
    { productName: 'אנטרייב אנגוס טרי ( 1 יח׳)', sku: '300068', qty: 15, unit: 'יח׳', unitPrice: 47, lineTotal: 705 },
    { productName: 'שפיץ שייטל אנגוס טרי ( 1 יח׳)', sku: '300012', qty: 10, unit: 'יח׳', unitPrice: 48, lineTotal: 480 },
    { productName: 'חזה עוף חצוי שלם טרי ( 1 ק״ג)', sku: '100003', qty: 12, unit: 'ק״ג', unitPrice: 29, lineTotal: 348 },
    { productName: 'חזה עוף פרוס (3) טרי ( 1 ק״ג)', sku: '100027', qty: 12, unit: 'ק״ג', unitPrice: 31, lineTotal: 372 },
    { productName: 'פרגית עוף קצר טרי ( 1 ק״ג)', sku: '100013', qty: 15, unit: 'ק״ג', unitPrice: 35, lineTotal: 525 },
    { productName: 'כבד עוף טרי ( 1 ק״ג)', sku: '100011', qty: 6, unit: 'ק״ג', unitPrice: 16, lineTotal: 96 },
    { productName: 'עצמות עוף טרי ( 1 ק״ג)', sku: '100026', qty: 10, unit: 'ק״ג', unitPrice: 3, lineTotal: 30 },
  ],
};

describe('mapExtractionToNormalized — Zestt order_7158745 golden fixture', () => {
  const po = mapExtractionToNormalized(ORDER_7158745, 'zestt');

  it('stamps the zestt platform and the supplier-order ref as externalId', () => {
    expect(po.platform).toBe('zestt');
    expect(po.externalId).toBe('7158745');
    expect(po.supplierName).toBe('רמדאן בשרים בע״מ');
    expect(po.supplierExternalId).toBe('רמדאן בשרים בע״מ');
    expect(po.status).toBe('sent');
    expect(po.currency).toBe('ILS');
  });

  it('normalizes the Israeli DD/MM/YYYY delivery date to an ISO datetime', () => {
    expect(po.expectedDeliveryAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('keeps all 10 lines with SKUs and Hebrew units verbatim', () => {
    expect(po.lines).toHaveLength(10);
    expect(po.lines[0]).toMatchObject({
      sku: '300099',
      rawDescription: 'טיבון עגלה אנגוס טרי ( 1 יח׳)',
      qty: 12,
      unit: 'יח׳',
      unitPrice: 84,
    });
    // Meat in יח׳, poultry in ק״ג — never normalized across dimensions.
    expect(po.lines.filter((l) => l.unit === 'יח׳')).toHaveLength(5);
    expect(po.lines.filter((l) => l.unit === 'ק״ג')).toHaveLength(5);
    expect(po.lines.map((l) => l.sku)).toEqual([
      '300099', '30094', '300010', '300068', '300012',
      '100003', '100027', '100013', '100011', '100026',
    ]);
  });

  it('carries the printed ex-VAT total and the checksum inputs', () => {
    expect(po.totalEstimated).toBe(5054);
    // Line totals sum to the printed ex-VAT (the import-time checksum).
    const lineSum = ORDER_7158745.lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
    expect(lineSum).toBe(5054);
    // 5054 × 1.18 = 5963.72 exactly — the dual-total checksum.
    expect(Math.round(5054 * 1.18 * 100) / 100).toBe(5963.72);
  });

  it('stashes header identifiers without a first-class column in metadata', () => {
    expect(po.metadata).toMatchObject({
      vatRate: 0.18,
      customerOrderRef: '80234-2239',
      buyerName: 'מיטבר הרצליה',
      totalInclVat: 5963.72,
    });
  });
});

describe('StubPoParser', () => {
  it('returns the mapped order from a raw extraction', async () => {
    const parser = new StubPoParser(ORDER_7158745, 'zestt');
    const po = await parser.parse(Buffer.from('ignored'));
    expect(po.platform).toBe('zestt');
    expect(po.lines).toHaveLength(10);
  });

  it('passes through an already-normalized order unchanged', async () => {
    const normalized = mapExtractionToNormalized(ORDER_7158745, 'zestt');
    const parser = new StubPoParser(normalized);
    expect(await parser.parse('x')).toEqual(normalized);
  });
});

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
    constructor(_opts: unknown) {}
  },
}));

describe('ClaudePoParser.parse — end to end with a mocked model', () => {
  beforeEach(() => createMock.mockReset());

  it('parses a canned Zestt PO JSON into a NormalizedPurchaseOrder', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(ORDER_7158745) }],
    });
    const parser = new ClaudePoParser({ apiKey: 'test-key', platform: 'zestt' });
    const po = await parser.parse('https://example.com/order_7158745.pdf');
    expect(po.platform).toBe('zestt');
    expect(po.externalId).toBe('7158745');
    expect(po.lines).toHaveLength(10);
    expect(po.totalEstimated).toBe(5054);
  });

  it('strips code fences before parsing', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify(ORDER_7158745) + '\n```' }],
    });
    const parser = new ClaudePoParser({ apiKey: 'test-key', platform: 'zestt' });
    const po = await parser.parse('https://example.com/order.pdf');
    expect(po.lines).toHaveLength(10);
  });
});
