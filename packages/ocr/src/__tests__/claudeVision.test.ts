import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeVision } from '../providers/claudeVision';

// Canned Hebrew invoice the mocked model "returns" as a JSON text block.
// Units are Hebrew (ק״ג / יח׳), there's an allocation number, per-line +
// top-level confidence, and an Israeli-VAT totals block.
const CANNED_INVOICE = {
  supplier: { name: 'ירקני אבי בע״מ', businessId: '514888888' },
  invoiceNumber: 'A-10293',
  invoiceDate: '2026-06-01',
  allocationNumber: '99887766',
  lines: [
    {
      rawDescription: 'עגבניה שרי',
      qty: 12.5,
      unit: 'ק״ג',
      unitPrice: 8.9,
      lineTotal: 111.25,
      vatRate: 0.17,
      confidence: 0.97,
    },
    {
      rawDescription: 'מלפפון חממה',
      qty: 3,
      unit: 'יח׳',
      unitPrice: 4.5,
      lineTotal: 13.5,
      confidence: 0.82,
    },
  ],
  totals: { subtotal: 124.75, vat: 21.21, total: 145.96 },
  confidence: 0.91,
};

const createMock = vi.fn();

// Mock the SDK so extract()'s lazy `import('@anthropic-ai/sdk')` resolves to a
// fake client. The default export is a constructable returning { messages }.
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = { create: createMock };
      constructor(_opts: unknown) {}
    },
  };
});

function mockTextResponse(obj: unknown) {
  createMock.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(obj) }],
  });
}

describe('ClaudeVision.extract — mapping', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('maps a canned Hebrew JSON invoice to a valid InvoiceOcrResult', async () => {
    mockTextResponse(CANNED_INVOICE);
    const provider = new ClaudeVision({ apiKey: 'test-key', model: 'claude-opus-4-8' });

    const result = await provider.extract('https://example.com/invoice.jpg');

    // Supplier + allocation number preserved.
    expect(result.supplier.name).toBe('ירקני אבי בע״מ');
    expect(result.allocationNumber).toBe('99887766');

    // Hebrew units preserved verbatim (never normalized away).
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.unit).toBe('ק״ג');
    expect(result.lines[1]?.unit).toBe('יח׳');

    // Quantities/prices passed through as numbers.
    expect(result.lines[0]?.qty).toBe(12.5);
    expect(result.lines[0]?.unitPrice).toBe(8.9);

    // VAT totals block intact.
    expect(result.totals.subtotal).toBe(124.75);
    expect(result.totals.vat).toBe(21.21);
    expect(result.totals.total).toBe(145.96);

    // Confidence flows through, top-level and per-line.
    expect(result.confidence).toBe(0.91);
    expect(result.lines[0]?.confidence).toBe(0.97);
    expect(result.lines[1]?.confidence).toBe(0.82);
  });

  it('strips code fences before parsing the JSON', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify(CANNED_INVOICE) + '\n```' }],
    });
    const provider = new ClaudeVision({ apiKey: 'test-key' });
    const result = await provider.extract('https://example.com/invoice.jpg');
    expect(result.invoiceNumber).toBe('A-10293');
  });

  it('defaults the model from OCR_CLAUDE_MODEL then claude-opus-4-8', async () => {
    mockTextResponse(CANNED_INVOICE);
    const provider = new ClaudeVision({ apiKey: 'test-key' });
    await provider.extract('https://example.com/invoice.jpg');
    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0]?.[0] as { model: string };
    expect(arg.model).toBe(process.env.OCR_CLAUDE_MODEL ?? 'claude-opus-4-8');
  });

  it('sends a URL image block for an http(s) image source', async () => {
    mockTextResponse(CANNED_INVOICE);
    const provider = new ClaudeVision({ apiKey: 'test-key' });
    await provider.extract('https://example.com/invoice.jpg');
    const arg = createMock.mock.calls[0]?.[0] as {
      messages: { content: { type: string; source?: { type: string } }[] }[];
    };
    const block = arg.messages[0]?.content.find((c) => c.type === 'image');
    expect(block?.source?.type).toBe('url');
  });

  it('throws on unparseable output so the job retries (no manufactured ₪)', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'מצטער, לא הצלחתי' }] });
    const provider = new ClaudeVision({ apiKey: 'test-key' });
    await expect(provider.extract('https://example.com/invoice.jpg')).rejects.toThrow();
  });

  it('throws on schema-invalid output (e.g. qty as a string)', async () => {
    const bad = { ...CANNED_INVOICE, lines: [{ ...CANNED_INVOICE.lines[0], qty: 'twelve' }] };
    mockTextResponse(bad);
    const provider = new ClaudeVision({ apiKey: 'test-key' });
    await expect(provider.extract('https://example.com/invoice.jpg')).rejects.toThrow();
  });
});

describe('ClaudeVision.extract — English rendering (Receiver in English)', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('asks for rawDescriptionEn in the same call and keeps it on each line', async () => {
    mockTextResponse({
      ...CANNED_INVOICE,
      lines: [
        { ...CANNED_INVOICE.lines[0], rawDescriptionEn: 'Cherry tomatoes' },
        { ...CANNED_INVOICE.lines[1], rawDescriptionEn: '  ' },
      ],
    });
    const result = await new ClaudeVision({ apiKey: 'k', model: 'm' }).extract('https://x/inv.jpg');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(String(createMock.mock.calls[0]![0].system)).toContain('rawDescriptionEn');
    const lines = result.lines as Array<{ rawDescriptionEn?: string }>;
    expect(lines[0]!.rawDescriptionEn).toBe('Cherry tomatoes');
    expect(lines[1]!.rawDescriptionEn).toBeUndefined();
    expect(result.lines[0]!.rawDescription).toBe('עגבניה שרי');
  });

  it('still parses older responses without the English field', async () => {
    mockTextResponse(CANNED_INVOICE);
    const result = await new ClaudeVision({ apiKey: 'k', model: 'm' }).extract('https://x/inv.jpg');
    expect((result.lines[0] as { rawDescriptionEn?: string }).rawDescriptionEn).toBeUndefined();
  });
});

describe('ClaudeVision.extract — nulls the prompt allows (EN-3)', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('accepts nulls in optional fields instead of failing the job', async () => {
    mockTextResponse({
      ...CANNED_INVOICE,
      supplier: { name: 'ספק', businessId: null, phone: null, contacts: [{ role: null, name: null, phone: null }] },
      invoiceNumber: null,
      invoiceDate: null,
      allocationNumber: null,
      lines: [{ ...CANNED_INVOICE.lines[0], sku: null, vatRate: null, confidence: null, rawDescriptionEn: null }],
      totals: { subtotal: null, vat: 21.21, total: null },
      confidence: null,
    });
    const r = await new ClaudeVision({ apiKey: 'k', model: 'm' }).extract('https://x/inv.jpg');
    expect(r.supplier.businessId).toBeUndefined();
    expect(r.invoiceNumber).toBeUndefined();
    expect(r.lines[0]!.vatRate).toBeUndefined();
    expect(r.lines[0]!.qty).toBe(12.5);
    expect(r.totals).toEqual({ vat: 21.21 });
  });

  it('repairs an unreadable line number from the other two, with low confidence', async () => {
    mockTextResponse({
      ...CANNED_INVOICE,
      lines: [
        { rawDescription: 'א', qty: 2, unit: 'ק״ג', unitPrice: null, lineTotal: 20, confidence: 0.95 },
        { rawDescription: 'ב', qty: null, unit: null, unitPrice: null, lineTotal: null },
        { rawDescription: null, qty: 1, unit: 'x', unitPrice: 1, lineTotal: 1 },
      ],
    });
    const r = await new ClaudeVision({ apiKey: 'k', model: 'm' }).extract('https://x/inv.jpg');
    expect(r.lines).toHaveLength(2); // a line with no description is dropped
    expect(r.lines[0]).toMatchObject({ qty: 2, unitPrice: 10, lineTotal: 20 });
    expect(r.lines[0]!.confidence).toBeLessThanOrEqual(0.2);
    expect(r.lines[1]).toMatchObject({ qty: 0, unitPrice: 0, lineTotal: 0, unit: '' });
    expect(r.lines[1]!.confidence).toBeLessThanOrEqual(0.2);
  });

  it('a present but malformed part is rejected, never turned into an empty invoice', async () => {
    mockTextResponse({ ...CANNED_INVOICE, lines: 'garbage' });
    await expect(new ClaudeVision({ apiKey: 'k', model: 'm' }).extract('https://x/inv.jpg')).rejects.toThrow();
    mockTextResponse({ ...CANNED_INVOICE, totals: { subtotal: '1,234.00', vat: 1, total: 2 } });
    await expect(new ClaudeVision({ apiKey: 'k', model: 'm' }).extract('https://x/inv.jpg')).rejects.toThrow();
  });

  it('still throws on a non-JSON answer (no silent empty invoice)', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'sorry' }] });
    await expect(new ClaudeVision({ apiKey: 'k', model: 'm' }).extract('https://x/inv.jpg')).rejects.toThrow();
  });
});

describe('ClaudeVision — effort + usage (benchmark knobs)', () => {
  beforeEach(() => {
    createMock.mockReset();
    delete process.env.OCR_CLAUDE_EFFORT;
  });

  it('sends no output_config by default (behaviour unchanged)', async () => {
    mockTextResponse(CANNED_INVOICE);
    await new ClaudeVision({ apiKey: 'k' }).extract('https://example.com/i.jpg');
    expect(createMock.mock.calls[0]![0]).not.toHaveProperty('output_config');
  });

  it('sends output_config.effort from config or OCR_CLAUDE_EFFORT; ignores junk', async () => {
    mockTextResponse(CANNED_INVOICE);
    await new ClaudeVision({ apiKey: 'k', effort: 'low' }).extract('https://example.com/i.jpg');
    expect(createMock.mock.calls[0]![0].output_config).toEqual({ effort: 'low' });

    process.env.OCR_CLAUDE_EFFORT = 'medium';
    mockTextResponse(CANNED_INVOICE);
    await new ClaudeVision({ apiKey: 'k' }).extract('https://example.com/i.jpg');
    expect(createMock.mock.calls[1]![0].output_config).toEqual({ effort: 'medium' });

    process.env.OCR_CLAUDE_EFFORT = 'turbo';
    mockTextResponse(CANNED_INVOICE);
    await new ClaudeVision({ apiKey: 'k' }).extract('https://example.com/i.jpg');
    expect(createMock.mock.calls[2]![0]).not.toHaveProperty('output_config');
  });

  it('reports usage to onUsage', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(CANNED_INVOICE) }],
      usage: { input_tokens: 1500, output_tokens: 700 },
    });
    const seen: unknown[] = [];
    await new ClaudeVision({ apiKey: 'k', onUsage: (u) => seen.push(u) }).extract('https://example.com/i.jpg');
    expect(seen).toEqual([{ input_tokens: 1500, output_tokens: 700 }]);
  });
});
