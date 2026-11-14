import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { DISPLAY_TTF_BASE64 } from '../reports/fonts/reportDisplayFont';
import type { MonthlyReportData } from '../reports/monthly';
import { assertNoShekel, displayCovers, renderMonthlyReportPdf } from '../reports/pdf';

/**
 * W3-08a2 · owner decision D11: Frank Ruhl Libre on the PDF cover (header band)
 * only, never for ₪. The display subset has no ₪ glyph; the renderer refuses a
 * ₪ string in the display face and falls back to the app face for a name the
 * subset cannot draw.
 */
const data = (restaurantName: string): MonthlyReportData => ({
  version: 1,
  month: '2026-10',
  restaurantName,
  leakAgorot: 75954,
  spendAgorot: 4226335,
  leakPct: 0.018,
  caughtAgorot: 29600,
  claimedAgorot: 46354,
  returnedAgorot: 126700,
  outstandingAgorot: 46400,
  invoiceCount: 37,
  invoicesWithLeak: 13,
  pendingLinkCount: 2,
  topSuppliers: [{ name: 'קצביית הכרם', nameEn: 'HaKerem Butchery', leakAgorot: 23132, leakPct: 0.021 }],
  topIssues: [{ type: 'PRICE_HIGHER', count: 7, amountAgorot: 40082 }],
  nextActions: [{ code: 'decideOpen', params: { count: 4, agorot: 29600 } }],
  generatedAt: '2026-11-01T05:45:00.000Z',
});

async function displayFont() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  return doc.embedFont(Buffer.from(DISPLAY_TTF_BASE64, 'base64'), { subset: true });
}

describe('D11 display face (Frank Ruhl Libre subset)', () => {
  it('draws Hebrew, Latin and digits, and has no ₪ glyph by design', async () => {
    const f = await displayFont();
    expect(displayCovers(f, 'דוח החודש · אוקטובר 2026')).toBe(true);
    expect(displayCovers(f, 'Month report · October 2026')).toBe(true);
    expect(displayCovers(f, '‏כפר הזיתים‎')).toBe(true); // bidi marks are fine
    expect(displayCovers(f, '₪759.54')).toBe(false);
    expect(displayCovers(f, 'Café')).toBe(false); // é is outside the subset → fallback
  });

  it('refuses a money string in the display face', () => {
    expect(() => assertNoShekel('₪759.54')).toThrow(/D11/);
    expect(() => assertNoShekel('759.54 ILS')).toThrow(/D11/);
    expect(() => assertNoShekel('דוח החודש · אוקטובר 2026')).not.toThrow();
  });

  it('renders the PDF with the display cover in he and en, and falls back for an uncovered name', async () => {
    for (const [name, locale] of [
      ['כפר הזיתים', 'he'],
      ['Kfar HaZeitim', 'en'],
      ['Café Nöel', 'en'],
    ] as const) {
      const bytes = await renderMonthlyReportPdf(data(name), { locale });
      expect(bytes.length, `${name} ${locale}`).toBeGreaterThan(1000);
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });
});
