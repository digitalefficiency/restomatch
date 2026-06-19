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
