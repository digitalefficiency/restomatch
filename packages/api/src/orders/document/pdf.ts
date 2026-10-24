import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { visualRtl } from './bidi';
import { priceFootnote } from './text';
import { ilsFromAgorot, qtyText } from './format';
import { HEEBO_500_BASE64, HEEBO_800_BASE64 } from './heebo-font';
import type { OrderDocument } from './types';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const INK = rgb(0.1, 0.12, 0.14);
const MUTED = rgb(0.38, 0.42, 0.46);
const LINE = rgb(0.82, 0.84, 0.86);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  has: Set<number>;
}

/** Characters Heebo can't draw become "?" (never a crash, never a tofu box). */
function drawable(text: string, fonts: Fonts): string {
  return Array.from(text.replace(/[‎‏؜\t\r\n]/g, ' '))
    .map((ch) => (ch === ' ' || fonts.has.has(ch.codePointAt(0)!) ? ch : '?'))
    .join('');
}

/** Shorten (logical order) until the drawn width fits, with an ellipsis. */
function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(visualRtl(text), size) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && font.widthOfTextAtSize(visualRtl(chars.join('') + '…'), size) > maxWidth) chars.pop();
  return chars.join('') + '…';
}

const HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;

/**
 * Split a VISUAL-order string into draw chunks. fontkit (pdf-lib's layout
 * engine) reverses a whole glyph run when the string's first script is
 * Hebrew, which would undo `visualRtl`. So each Hebrew glyph is drawn on its
 * own (reversing one glyph is a no-op) and non-Hebrew runs are drawn whole.
 */
export function drawChunks(visual: string): string[] {
  const out: string[] = [];
  let run = '';
  for (const ch of Array.from(visual)) {
    if (HEBREW.test(ch)) {
      if (run) out.push(run);
      run = '';
      out.push(ch);
    } else {
      run += ch;
    }
  }
  if (run) out.push(run);
  return out;
}

/** Draw `text` (logical order) right-aligned so its right edge sits at `right`. */
function drawRtl(page: PDFPage, text: string, right: number, y: number, font: PDFFont, size: number, color = INK) {
  const chunks = drawChunks(visualRtl(text));
  const widths = chunks.map((c) => font.widthOfTextAtSize(c, size));
  let x = right - widths.reduce((a, b) => a + b, 0);
  chunks.forEach((c, i) => {
    page.drawText(c, { x, y, size, font, color });
    x += widths[i]!;
  });
}

/** Columns from the right edge (RTL): description, SKU, qty, unit, unit price, total. */
function columns(showPrices: boolean, width: number) {
  const right = A4[0] - MARGIN;
  const cols = showPrices
    ? [
        { key: 'description', w: width * 0.36 },
        { key: 'sku', w: width * 0.14 },
        { key: 'qty', w: width * 0.09 },
        { key: 'unit', w: width * 0.09 },
        { key: 'price', w: width * 0.16 },
        { key: 'total', w: width * 0.16 },
      ]
    : [
        { key: 'description', w: width * 0.56 },
        { key: 'sku', w: width * 0.2 },
        { key: 'qty', w: width * 0.12 },
        { key: 'unit', w: width * 0.12 },
      ];
  let edge = right;
  return cols.map((c) => {
    const col = { ...c, right: edge, w: c.w - 6 };
    edge -= c.w;
    return col;
  });
}

const HEADERS: Record<string, string> = {
  description: 'פריט',
  sku: 'מק״ט',
  qty: 'כמות',
  unit: 'יחידה',
  price: 'מחיר ליחידה',
  total: 'סה״כ',
};

/** The supplier-facing order as a Hebrew RTL A4 PDF (bytes). */
export async function renderOrderPdf(doc: OrderDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(`הזמנה ${doc.orderRef}`);
  pdf.setAuthor(doc.restaurantName);
  pdf.setCreator('RestoMatch');
  pdf.setProducer('RestoMatch');
  pdf.setLanguage('he-IL');
  const regular = await pdf.embedFont(Buffer.from(HEEBO_500_BASE64, 'base64'), { subset: true });
  const bold = await pdf.embedFont(Buffer.from(HEEBO_800_BASE64, 'base64'), { subset: true });
  const fonts: Fonts = { regular, bold, has: new Set(regular.getCharacterSet()) };
  const t = (s: string) => drawable(s, fonts);

  const width = A4[0] - 2 * MARGIN;
  const right = A4[0] - MARGIN;
  const cols = columns(doc.showPrices, width);
  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  const header = () => {
    drawRtl(page, t(`הזמנה לספק ${doc.supplierName}`), right, y - 18, bold, 18);
    y -= 40;
    const meta = [
      `מאת: ${doc.restaurantName}`,
      `מס׳ הזמנה: ${doc.orderRef}   ·   תאריך: ${doc.orderDate}${doc.deliveryDate ? `   ·   אספקה מבוקשת: ${doc.deliveryDate}` : ''}`,
    ];
    for (const m of meta) {
      drawRtl(page, t(m), right, y, regular, 10, MUTED);
      y -= 15;
    }
    y -= 8;
    for (const c of cols) drawRtl(page, t(HEADERS[c.key]!), c.right, y, bold, 9.5, MUTED);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.8, color: LINE });
    y -= 15;
  };
  header();

  for (const l of doc.lines) {
    if (y < MARGIN + 90) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
      header();
    }
    const cell: Record<string, string> = {
      description: l.description,
      sku: l.sku ?? '—',
      qty: qtyText(l.qty),
      unit: l.unit,
      price: l.unitPriceAgorot !== null ? `${ilsFromAgorot(l.unitPriceAgorot)}${l.contractPrice ? ' · חוזה' : ''}` : '—',
      total: l.lineTotalAgorot !== null ? ilsFromAgorot(l.lineTotalAgorot) : '—',
    };
    for (const c of cols) {
      const font = c.key === 'total' ? bold : regular;
      drawRtl(page, fit(t(cell[c.key]!), font, 10, c.w), c.right, y, font, 10);
    }
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.3, color: LINE });
    y -= 13;
  }

  y -= 6;
  if (doc.showPrices) {
    drawRtl(page, t(`סה״כ הזמנה (לפני מע״מ): ${ilsFromAgorot(doc.totalAgorot)}`), right, y, bold, 13);
    y -= 18;
    if (doc.hasUnpricedLines) {
      drawRtl(page, t('שורות ללא מחיר אינן כלולות בסה״כ.'), right, y, regular, 9, MUTED);
      y -= 14;
    }
    for (const note of priceFootnote(doc)) {
      drawRtl(page, t(note), right, y, regular, 9, MUTED);
      y -= 16;
    }
  }
  if (doc.notes) {
    drawRtl(page, fit(t(`הערות: ${doc.notes}`), regular, 10, width), right, y, regular, 10);
    y -= 16;
  }
  for (const extra of doc.extraLines) {
    if (y < MARGIN + 20) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }
    drawRtl(page, fit(t(extra), regular, 10, width), right, y, regular, 10);
    y -= 15;
  }
  return pdf.save({ useObjectStreams: true });
}
