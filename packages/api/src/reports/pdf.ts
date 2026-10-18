import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { visualOrder } from './bidi';
import { BOLD_TTF_BASE64, REGULAR_TTF_BASE64 } from './fonts/reportFont';
import {
  issueLabel,
  monthLabel,
  nextActionText,
  reportCopy,
  reportFormatter,
  supplierLabel,
  type MonthlyReportData,
} from './monthly';
import type { ReportLocale } from './money';

/**
 * Server-side PDF of the monthly report — pdf-lib + an embedded subset font.
 *
 * Why pdf-lib (and not Puppeteer/Playwright, @react-pdf or pdfkit):
 *  • no headless browser — Vercel functions can't ship Chromium within limits;
 *  • pure JavaScript, zero native deps, no filesystem reads at runtime (pdfkit
 *    reads its AFM font files from disk, which Next's output tracing drops);
 *  • runs the same in the worker, a Next route handler and a unit test;
 *  • ~0.7 MB installed; the font is a 55 KB Hebrew+Latin subset embedded as
 *    base64 and subset again per document, so a report is ~30 KB.
 * Trade-off: no layout engine or bidi — the page is a fixed A4 layout drawn
 * with coordinates, and Hebrew is reordered by ./bidi.ts.
 */

const A4: [number, number] = [595.28, 841.89];
const M = 48; // page margin
const C = {
  ink: rgb(0.06, 0.09, 0.16),
  muted: rgb(0.39, 0.45, 0.55),
  line: rgb(0.89, 0.91, 0.94),
  danger: rgb(0.86, 0.15, 0.15),
  gold: rgb(0.71, 0.33, 0.04),
  band: rgb(0.04, 0.05, 0.08),
  white: rgb(1, 1, 1),
};

interface Ctx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  rtl: boolean;
  y: number;
}

/** Draw `text` aligned to the reading start (right in Hebrew) or end of the content box. */
function draw(
  ctx: Ctx,
  text: string,
  opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; at?: 'start' | 'end'; y?: number; inset?: number } = {},
) {
  const font = opts.bold ? ctx.bold : ctx.regular;
  const size = opts.size ?? 11;
  const visual = visualOrder(text, ctx.rtl ? 'rtl' : 'ltr');
  const width = font.widthOfTextAtSize(visual, size);
  const atStart = (opts.at ?? 'start') === 'start';
  const inset = opts.inset ?? 0;
  const leftEdge = M + inset;
  const rightEdge = A4[0] - M - inset;
  // Start of reading = right edge in RTL, left edge in LTR.
  const x = atStart === ctx.rtl ? rightEdge - width : leftEdge;
  ctx.page.drawText(visual, { x, y: opts.y ?? ctx.y, size, font, color: opts.color ?? C.ink });
}

function rule(ctx: Ctx, y: number) {
  ctx.page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.7, color: C.line });
}

export async function renderMonthlyReportPdf(
  data: MonthlyReportData,
  opts: { locale?: ReportLocale } = {},
): Promise<Uint8Array> {
  const locale = opts.locale ?? 'he';
  const c = reportCopy(locale);
  const f = reportFormatter(locale);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`RestoMatch — ${c.title} ${data.month}`);
  doc.setAuthor('RestoMatch');
  doc.setLanguage(locale === 'he' ? 'he-IL' : 'en-GB');
  doc.setCreationDate(new Date(data.generatedAt));
  doc.setModificationDate(new Date(data.generatedAt));
  const regular = await doc.embedFont(Buffer.from(REGULAR_TTF_BASE64, 'base64'), { subset: true });
  const bold = await doc.embedFont(Buffer.from(BOLD_TTF_BASE64, 'base64'), { subset: true });
  const page = doc.addPage(A4);
  const ctx: Ctx = { page, regular, bold, rtl: locale === 'he', y: A4[1] - M };

  // Header band.
  page.drawRectangle({ x: 0, y: A4[1] - 92, width: A4[0], height: 92, color: C.band });
  draw(ctx, 'RestoMatch', { size: 18, bold: true, color: C.white, y: A4[1] - 44 });
  draw(ctx, `${c.title} · ${monthLabel(data.month, locale)}`, { size: 12, color: C.white, y: A4[1] - 68 });
  draw(ctx, data.restaurantName, { size: 11, color: C.white, at: 'end', y: A4[1] - 44 });

  // The one number.
  ctx.y = A4[1] - 140;
  draw(ctx, c.leak, { size: 12, color: C.muted });
  ctx.y -= 40;
  draw(ctx, f.ils(data.leakAgorot), { size: 38, bold: true, color: C.danger });
  draw(ctx, `${f.pct(data.leakPct)} ${c.ofSpend}`, { size: 16, bold: true, color: C.ink, at: 'end' });
  ctx.y -= 20;
  draw(ctx, c.oneNumber(f.ils(data.leakAgorot), f.pct(data.leakPct)), { size: 10, color: C.muted });

  // Money flow.
  ctx.y -= 30;
  const flow: Array<[string, number, ReturnType<typeof rgb>]> = [
    [c.spend, data.spendAgorot, C.ink],
    [c.caught, data.caughtAgorot, C.gold],
    [c.claimed, data.claimedAgorot, C.ink],
    [c.returned, data.returnedAgorot, C.gold],
    [c.outstanding, data.outstandingAgorot, C.danger],
  ];
  for (const [label, agorot, color] of flow) {
    draw(ctx, label, { size: 12, color: C.muted });
    draw(ctx, f.ils(agorot), { size: 12, bold: true, color, at: 'end' });
    rule(ctx, ctx.y - 8);
    ctx.y -= 26;
  }

  const section = (title: string, rows: Array<[string, string]>, empty: string) => {
    ctx.y -= 14;
    draw(ctx, title, { size: 13, bold: true });
    ctx.y -= 22;
    if (rows.length === 0) {
      draw(ctx, empty, { size: 11, color: C.muted });
      ctx.y -= 20;
      return;
    }
    rows.forEach(([label, value], i) => {
      draw(ctx, `${i + 1}. ${label}`, { size: 11 });
      if (value) draw(ctx, value, { size: 11, bold: true, at: 'end' });
      ctx.y -= 19;
    });
  };

  section(
    c.topSuppliers,
    data.topSuppliers.map((s) => [supplierLabel(s, locale), `${f.ils(s.leakAgorot)} · ${f.pct(s.leakPct)}`]),
    c.noLeak,
  );
  section(
    c.topIssues,
    data.topIssues.map((i) => [`${issueLabel(i.type, locale)} (${i.count})`, f.ils(i.amountAgorot)]),
    c.noLeak,
  );
  section(
    c.nextActions,
    data.nextActions.map((a) => [nextActionText(a, locale), '']),
    c.noLeak,
  );

  // Footer.
  rule(ctx, M + 18);
  ctx.y = M;
  draw(ctx, c.footer, { size: 9, color: C.muted });
  draw(ctx, new Date(data.generatedAt).toISOString().slice(0, 10), { size: 9, color: C.muted, at: 'end' });

  return doc.save({ useObjectStreams: true });
}
