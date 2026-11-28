// DS3-04 §7.1 (S3): the evidence side views as static markup (react-dom/server, as ds3-density.test.ts) — the 12 gap
// types, the decision bar's variants, the reasons row, the documents and the empty panel.
import '@/lib/components/__tests__/reactGlobal';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/client';
import { BILLED_OVER_RECEIVED } from '../desk-facts';
import { EvidencePanel, blockText, type EvidencePanelProps } from '../evidence';
import { DecisionBar, type DecisionBarProps, type DecisionBlockText } from '../decision-bar';
import { NowProvider } from '../queue';
import type { DeskController, GapDocument, PaperLine, QueueItem, QueueSummary } from '../desk-types';

// HistoryDisclosure (history.tsx) keeps its own read: a quiet stand-in for the tRPC hook, nothing on the network.
vi.mock('@/lib/trpc/client', () => ({
  trpc: { approvals: { history: { useQuery: () => ({ isLoading: false, isError: false, data: [], refetch: () => undefined }) } } },
}));

// Loosely typed createElement: two @types/react majors are hoisted in the workspace (STATE.md).
const h = createElement as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactElement;
const render = (el: ReactElement) => renderToStaticMarkup(h(I18nProvider, { locale: 'he' }, el));
const noop = () => undefined;
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const VOID = new Set(['img', 'input', 'col', 'br', 'hr', 'meta', 'link', 'source', 'area', 'base', 'wbr', 'track', 'embed']);
/** The outer HTML of the first element whose start tag holds `marker` ('' when absent). React's markup is well formed. */
function outer(html: string, marker: string): string {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  const start = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1] ?? '';
  if (VOID.has(tag)) return html.slice(start, html.indexOf('>', at) + 1);
  const re = new RegExp(`<(/?)${tag}(?=[\\s>])`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, html.indexOf('>', m.index) + 1);
  }
  return html.slice(start);
}
const byTestId = (html: string, id: string) => outer(html, `data-testid="${id}"`);
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The words a reader sees: tags out, entities decoded, bidi marks (FSI/PDI, LRM/RLM) out, no-break spaces as spaces. */
const text = (html: string) =>
  decode(html.replace(/<[^>]+>/g, ''))
    .replace(/[⁦-⁩‎‏]/g, '')
    .replace(/ /g, ' ');
const classOf = (html: string, marker: string) => decode(outer(html, marker).match(/^<[^>]*class="([^"]*)"/)?.[1] ?? '');
/** Every money figure of a fragment, in DOM order ("‏1,180.00 ₪" → 1180). */
const figures = (html: string) => [...text(html).matchAll(/(\d[\d,]*\.\d{2})/g)].map((m) => Number(m[1]!.replace(/,/g, '')));

// ── fixtures: one row per gap type (stack.md's demo rows where one exists) ──────────────────────────────
const BASE: QueueItem = {
  id: 'r-price',
  type: 'PRICE_HIGHER',
  severity: 'warn',
  resolutionStatus: 'open',
  requiredRole: 'owner',
  deltaAmount: '104.80',
  expectedValue: '522.6000',
  actualValue: '575.0000',
  toleranceUsed: 'price: ±2% or ₪5',
  ruleName: null,
  ruleId: null,
  productName: 'בירה מהחבית',
  productNameEn: 'Draught beer',
  supplierName: 'משקאות שטיינברג',
  supplierNameEn: 'Steinberg Drinks',
  invoiceNumber: 'ST-24108',
  invoiceDueDate: null,
  invoiceStatus: 'matched',
  invoiceDate: new Date('2026-10-15T09:00:00.000Z'),
  hasScan: false,
  message: null,
  createdAt: new Date('2026-10-20T08:00:00.000Z'),
  matchRunId: 'mr-1',
  invoiceId: 'inv-1',
  invoiceLineId: 'line-1',
  lineDescription: null,
  lineDescriptionEn: null,
  qtyBilled: '2.000',
  billedUnit: 'חבית',
  unitPriceBilled: '575.0000',
  lineTotal: '1150.00',
  qtyOrdered: '2.000',
  orderedUnit: 'חבית',
  unitPriceExpected: '522.6000',
  qtyReceived: null,
  poId: 'po-1',
  poRef: 'PO-STEIN',
  poDate: new Date('2026-10-14T06:00:00.000Z'),
  claimable: true,
  claimAgorot: 10480,
  canAct: true,
  waitingOn: 'owner',
};
const row = (o: Partial<QueueItem>): QueueItem => ({ ...BASE, ...o });
const invoiceLevel: Partial<QueueItem> = {
  invoiceLineId: null,
  productName: null,
  productNameEn: null,
  qtyBilled: null,
  billedUnit: null,
  unitPriceBilled: null,
  lineTotal: null,
  qtyOrdered: null,
  orderedUnit: null,
  unitPriceExpected: null,
};

const ROWS = {
  PRICE_HIGHER: BASE, // ST-24108: 2 חבית × (575 − 522.60) = 104.80
  PRICE_LOWER: row({
    id: 'r-lower',
    type: 'PRICE_LOWER',
    severity: 'info',
    deltaAmount: '-5.00',
    expectedValue: '10.0000',
    actualValue: '9.0000',
    qtyBilled: '5.000',
    billedUnit: 'ק״ג',
    qtyOrdered: '5.000',
    orderedUnit: 'ק״ג',
    unitPriceExpected: '10.0000',
    unitPriceBilled: '9.0000',
    lineTotal: '45.00',
    claimable: false,
    claimAgorot: 0,
  }),
  QTY_SHORT: row({
    id: 'r-short',
    type: 'QTY_SHORT',
    severity: 'info',
    deltaAmount: '6.00',
    expectedValue: '3.0000',
    actualValue: '2.0000',
    toleranceUsed: 'qty: ±2% or 1 unit',
    qtyBilled: '3.000',
    billedUnit: 'יח׳',
    qtyOrdered: '3.000',
    orderedUnit: 'יח׳',
    unitPriceExpected: '6.0000',
    unitPriceBilled: '6.0000',
    lineTotal: '18.00',
    claimable: false,
    claimAgorot: 0,
  }),
  QTY_OVER: row({
    id: 'r-over',
    type: 'QTY_OVER', // SH-24121, 5b: (9.5 − 6.5) ק״ג × 12.90 = 38.70
    severity: 'block',
    deltaAmount: '38.70',
    expectedValue: '6.5000',
    actualValue: '9.5000',
    toleranceUsed: BILLED_OVER_RECEIVED,
    productName: 'עגבניות שרי',
    supplierName: 'ירקות השרון',
    invoiceNumber: 'SH-24121',
    qtyBilled: '9.500',
    billedUnit: 'ק״ג',
    qtyOrdered: '9.500',
    orderedUnit: 'ק״ג',
    qtyReceived: '6.500',
    unitPriceExpected: '12.9000',
    unitPriceBilled: '12.9000',
    lineTotal: '122.55',
    claimAgorot: 3870,
  }),
  UNORDERED_ITEM: row({
    id: 'r-unordered',
    type: 'UNORDERED_ITEM',
    deltaAmount: '100.00',
    expectedValue: null,
    actualValue: '4.0000',
    qtyBilled: '4.000',
    billedUnit: 'יח׳',
    unitPriceBilled: '25.0000',
    lineTotal: '100.00',
    qtyOrdered: null,
    orderedUnit: null,
    unitPriceExpected: null,
    poId: null,
    poDate: null,
    claimAgorot: 10000,
  }),
  MISSING_ON_INVOICE: row({
    id: 'r-missing',
    type: 'MISSING_ON_INVOICE',
    deltaAmount: '50.00',
    expectedValue: '5.0000',
    actualValue: null,
    invoiceLineId: null,
    qtyBilled: null,
    billedUnit: null,
    unitPriceBilled: null,
    lineTotal: null,
    qtyOrdered: '5.000',
    orderedUnit: 'ק״ג',
    unitPriceExpected: '10.0000',
    qtyReceived: '5.000',
    claimable: false,
    claimAgorot: 0,
  }),
  UNIT_MISMATCH: row({
    id: 'r-unit',
    type: 'UNIT_MISMATCH',
    deltaAmount: '0.00',
    qtyBilled: '2.000',
    billedUnit: 'ארגז',
    qtyOrdered: '24.000',
    orderedUnit: 'יח׳',
    claimable: false,
    claimAgorot: 0,
  }),
  UNORDERED_ARRIVAL: row({
    ...invoiceLevel,
    id: 'r-arrival',
    type: 'UNORDERED_ARRIVAL',
    severity: 'info',
    deltaAmount: '1180.00',
    expectedValue: null,
    actualValue: null,
    poId: null,
    poDate: null,
    claimable: false,
    claimAgorot: 0,
  }),
  DUPLICATE_INVOICE: row({
    ...invoiceLevel,
    id: 'r-dup',
    type: 'DUPLICATE_INVOICE',
    severity: 'block',
    deltaAmount: '1180.00',
    expectedValue: null,
    actualValue: null,
    claimAgorot: 118000,
  }),
  DATE_ANOMALY: row({
    ...invoiceLevel,
    id: 'r-date',
    type: 'DATE_ANOMALY',
    severity: 'info',
    deltaAmount: '0.00',
    expectedValue: null,
    actualValue: null,
    claimable: false,
    claimAgorot: 0,
  }),
  VAT_MISMATCH: row({
    ...invoiceLevel,
    id: 'r-vat',
    type: 'VAT_MISMATCH', // printed 178.30 against 180.00 by the rate: the larger figure first (R4)
    deltaAmount: '1.70',
    expectedValue: '180.0000',
    actualValue: '178.3000',
    toleranceUsed: '18% VAT on subtotal, ±₪1',
    claimAgorot: 170,
  }),
  TOTAL_MISMATCH: row({
    ...invoiceLevel,
    id: 'r-total',
    type: 'TOTAL_MISMATCH', // E = the sum of the lines, A = the printed subtotal
    severity: 'block',
    deltaAmount: '10.00',
    expectedValue: '990.0000',
    actualValue: '1000.0000',
    toleranceUsed: 'total: ±₪1',
    claimable: false,
    claimAgorot: 0,
  }),
} satisfies Record<string, QueueItem>;

const SUMMARY: QueueSummary = {
  count: 4,
  blockers: 2,
  oldestAt: null,
  claimableIls: 296,
  duplicateIls: 0,
  vatIls: 0,
  toDecide: { count: 4, amountIls: 296 },
  toReview: { count: 0 },
  others: { count: 0, amountIls: 0, byRole: [] },
};

const HIT: PaperLine = { id: 'line-1', name: 'בירה מהחבית', qty4: 20000n, unit: 'חבית', unitPrice4: 5_750_000n, totalAgorot: 115_000n, hit: true };
const READY: GapDocument = {
  status: 'ready',
  lines: [HIT, { id: 'line-2', name: 'סודה', qty4: 10000n, unit: 'ארגז', unitPrice4: 300_000n, totalAgorot: 3_000n, hit: false }],
  more: 4,
  hasImage: false,
  grId: 'gr-1',
  grReceivedAt: new Date('2026-10-15T07:30:00.000Z'),
  duplicateOf: 'ST-24001',
};

function ctl(current: QueueItem | null, o: Partial<DeskController> = {}): DeskController {
  return {
    mode: 'desk',
    rows: current ? [{ row: current, state: 'open', result: null, current: true, checked: false, roving: true }] : [],
    tiers: [],
    live: current ? [current] : [],
    current,
    currentState: current ? 'open' : null,
    next: null,
    position: current ? { index: 1, total: 4 } : null,
    canPrev: false,
    canNext: true,
    summary: SUMMARY,
    hasMore: false,
    loadingMore: false,
    siblings: current ? [current] : [],
    note: null,
    elsewhereText: null,
    asking: null,
    undo: null,
    announcement: '',
    selection: { ids: new Set<string>(), rows: [], sumAgorot: 0, disabled: true, reason: null, note: null, busy: false },
    escalateFor: null,
    keysOpen: false,
    focus: null,
    motion: null,
    select: noop,
    move: noop,
    claim: noop,
    openReasons: noop,
    closeReasons: noop,
    pay: noop,
    requestEscalate: noop,
    escalate: noop,
    closeEscalate: noop,
    undoLast: noop,
    expireUndo: noop,
    toggleChecked: noop,
    clearChecked: noop,
    approveChecked: noop,
    approveInvoice: noop,
    hideElsewhere: noop,
    retry: noop,
    loadMore: noop,
    setKeysOpen: noop,
    focusQueue: noop,
    consumeFocus: noop,
    ...o,
  };
}

/** The render's clock, as ApprovalsList provides it (NowCtx, #418): the waiting pill counts days from it. */
const NOW = Date.parse('2026-10-22T10:00:00.000Z');
const panel = (c: DeskController, o: Partial<EvidencePanelProps> = {}) =>
  render(
    h(
      NowProvider,
      { value: NOW },
      h(EvidencePanel, {
        c,
        doc: READY,
        mode: 'desk',
        density: 'regular',
        singleKeys: true,
        wide: true,
        filtered: false,
        onEvidenceKeyDown: noop,
        viewerRole: 'owner',
        ...o,
      } satisfies EvidencePanelProps),
    ),
  );
const bar = (c: DeskController, o: Partial<DecisionBarProps> = {}) =>
  render(h(DecisionBar, { c, mode: 'desk', singleKeys: true, wide: true, viewerRole: 'owner', ...o } satisfies DecisionBarProps));

// ── the 12 types ───────────────────────────────────────────────────────────────────────────────

describe('the evidence of each of the 12 gap types', () => {
  const TABLE = ['PRICE_HIGHER', 'PRICE_LOWER', 'QTY_SHORT', 'QTY_OVER', 'UNORDERED_ITEM', 'MISSING_ON_INVOICE'] as const;
  const FACT = ['UNIT_MISMATCH', 'UNORDERED_ARRIVAL', 'DUPLICATE_INVOICE', 'DATE_ANOMALY'] as const;
  const CALC_ONLY = ['VAT_MISMATCH', 'TOTAL_MISMATCH'] as const;

  it('covers every type exactly once', () => {
    expect(new Set([...TABLE, ...FACT, ...CALC_ONLY]).size).toBe(12);
    expect(Object.keys(ROWS).sort()).toEqual([...TABLE, ...FACT, ...CALC_ONLY].sort());
  });

  for (const type of TABLE) {
    it(`${type}: the three-way table with exactly one flagged cell, then the calculation line`, () => {
      const html = panel(ctl(ROWS[type]));
      const body = byTestId(html, 'approval-evidence');
      expect(body).toContain(`data-id="${ROWS[type].id}"`);
      const table = byTestId(body, 'match-table');
      expect(table).not.toBe('');
      expect(count(table, /data-testid="match-cell-off"/g)).toBe(1);
      expect(table).toContain('<caption class="sr-only">השוואה בין מה שהוזמן, מה שהתקבל ומה שחויב</caption>');
      expect(text(table)).toContain('מחיר ליחידה');
      expect(text(table)).toContain('לפני מע״מ'); // the unit-price row's basis (R7g)
      expect(byTestId(body, 'calc-line')).not.toBe('');
      expect(byTestId(body, 'desk-fact')).toBe('');
      // the result is always the stored |Δ|
      const delta = Math.abs(Number(ROWS[type].deltaAmount));
      expect(figures(byTestId(body, 'calc-result'))).toEqual([delta]);
      // no money figure in the table or the result is ever red: the one red is a written quantity / percent gap
      expect(byTestId(body, 'calc-line')).not.toContain('text-danger');
      expect(table).not.toMatch(/<bdi[^>]*text-danger/);
      expect(count(table, /text-danger/g)).toBe(ROWS[type].severity === 'block' ? 1 : 0);
    });
  }

  it('the demo rows factorise: 2 חבית × 52.40 and (9.5 − 6.5) ק״ג × 12.90', () => {
    const price = text(byTestId(panel(ctl(ROWS.PRICE_HIGHER)), 'calc-line'));
    expect(price).toMatch(/2 חבית\s*×\s*52\.40 ₪ יותר לחבית\s*=\s*104\.80 ₪\s*לפני מע״מ/);
    const over = text(byTestId(panel(ctl(ROWS.QTY_OVER)), 'calc-line'));
    expect(over).toMatch(/3 ק״ג שלא התקבלו\s*×\s*12\.90 ₪\s*=\s*38\.70 ₪\s*לפני מע״מ/);
    expect(over).toContain('הכלל: הכמות שחויבה עולה על הכמות שהתקבלה');
    // the fold opens the same formula with a source for each operand
    const fold = byTestId(panel(ctl(ROWS.QTY_OVER)), 'calc-line');
    expect(fold).toContain('data-calculation-fold=""');
    expect(count(fold, /data-calc-source=/g)).toBe(2);
    expect(text(fold)).toContain('9.5 ק״ג חויבו, 6.5 ק״ג נספרו');
  });

  it('the flagged cell of 5b is the received quantity, its gap written in the leak tone (a quantity, never ₪)', () => {
    const table = byTestId(panel(ctl(ROWS.QTY_OVER)), 'match-table');
    const off = outer(table, 'data-testid="match-cell-off"');
    expect(off).toContain('data-cell="received"');
    expect(text(off)).toContain('3 ק״ג פחות');
    expect(off).toMatch(/<span class="[^"]*\btext-danger\b[^"]*">3 ק״ג פחות<\/span>/);
    expect(text(table)).toContain('הזמנה מ־'); // the order by its date, never its code
    expect(table).not.toContain('PO-STEIN');
  });

  for (const type of CALC_ONLY) {
    it(`${type}: the calculation alone, a minus with the larger figure first — in both directions (R4)`, () => {
      const r = ROWS[type];
      const flipped = row({ ...r, actualValue: type === 'VAT_MISMATCH' ? '181.7000' : '980.0000' });
      for (const g of [r, flipped]) {
        const body = byTestId(panel(ctl(g)), 'approval-evidence');
        expect(byTestId(body, 'match-table')).toBe('');
        expect(byTestId(body, 'desk-fact')).toBe('');
        const line = byTestId(body, 'calc-line');
        expect(text(line)).toContain('−');
        const [left, right, result] = figures(outer(line, 'class="num flex'));
        expect(left).toBeGreaterThanOrEqual(right!);
        expect(result).toBe(Math.abs(Number(g.deltaAmount)));
        expect(result).toBeCloseTo(left! - right!, 2);
      }
      if (type === 'VAT_MISMATCH') {
        // the printed VAT below the rate: "180.00 by the rate − 178.30 on the invoice", the VAT itself as the basis
        expect(text(byTestId(panel(ctl(r)), 'calc-line'))).toMatch(/180\.00 ₪ המע״מ לפי השיעור\s*−\s*178\.30 ₪ המע״מ בחשבונית/);
        expect(text(byTestId(panel(ctl(r)), 'calc-line'))).toContain('סכום המע״מ עצמו');
      }
    });
  }

  for (const type of FACT) {
    it(`${type}: one fact card, no table and no calculation`, () => {
      const body = byTestId(panel(ctl(ROWS[type])), 'approval-evidence');
      expect(byTestId(body, 'desk-fact')).not.toBe('');
      expect(byTestId(body, 'match-table')).toBe('');
      expect(byTestId(body, 'calc-line')).toBe('');
    });
  }

  it('the fact cards say their facts with their basis', () => {
    const dup = text(byTestId(panel(ctl(ROWS.DUPLICATE_INVOICE)), 'desk-fact'));
    expect(dup).toContain('סה״כ העותק, כולל מע״מ: 1,180.00 ₪');
    expect(dup).toContain('עותק של חשבונית ST-24001'); // from the ready document
    expect(text(byTestId(panel(ctl(ROWS.UNORDERED_ARRIVAL)), 'desk-fact'))).toContain('סה״כ החשבונית, כולל מע״מ: 1,180.00 ₪');
    expect(text(byTestId(panel(ctl(ROWS.UNIT_MISMATCH)), 'desk-fact'))).toBe('בחשבונית 2 ארגז, בהזמנה 24 יח׳');
    expect(text(byTestId(panel(ctl(ROWS.DATE_ANOMALY)), 'desk-fact'))).toBe('תאריך החשבונית רחוק ממועד האספקה.');
  });
});

// ── the top line, the title, the body ────────────────────────────────────────────────────────────

describe('the evidence top line and body', () => {
  it('pills, position and prev / next; the type as a heading that never takes focus on mount', () => {
    const html = panel(ctl(ROWS.QTY_OVER));
    expect(text(byTestId(html, 'desk-pill-severity'))).toBe('חוסם תשלום');
    expect(byTestId(html, 'desk-pill-severity')).toContain('data-pill="solid"');
    expect(text(byTestId(html, 'desk-pill-waiting'))).toBe('ממתין יומיים'); // 20.10 08:00 → the server clock 22.10 10:00
    expect(text(byTestId(html, 'desk-position'))).toBe('1 מתוך 4');
    expect(classOf(html, 'data-testid="desk-position"').split(' ')).toContain('num');
    expect(byTestId(html, 'desk-prev')).toContain('disabled=""');
    expect(byTestId(html, 'desk-next')).not.toContain('disabled=""');
    expect(byTestId(html, 'desk-next')).toContain('aria-label="הפער הבא"');
    expect(outer(html, 'data-desk-heading=""')).toMatch(/^<h2 tabindex="-1" data-desk-heading=""/);
    expect(text(outer(html, 'data-desk-heading=""'))).toBe('חיוב על יותר ממה שהתקבל');
    expect(html).toContain('עגבניות שרי');
    expect(text(html)).toContain('חשבונית SH-24121 מיום 15.10.2026');
    // the top line is not keyed with the body; both are data for the copy meter
    expect(html.indexOf('data-testid="desk-position"')).toBeLessThan(html.indexOf('data-testid="approval-evidence"'));
    expect(count(html, /data-record=""/g)).toBeGreaterThanOrEqual(3); // top line, body, decision bar
    expect(byTestId(html, 'approval-evidence')).toContain('data-pane="document"');
    expect(byTestId(html, 'approval-history')).not.toBe('');
  });

  it('warn and info pills; a gap decided elsewhere shows its result and "הוחלט"', () => {
    expect(text(byTestId(panel(ctl(ROWS.PRICE_HIGHER)), 'desk-pill-severity'))).toBe('אזהרה');
    expect(text(byTestId(panel(ctl(ROWS.QTY_SHORT)), 'desk-pill-severity'))).toBe('לידיעה');
    const away = ctl(BASE, {
      currentState: 'elsewhere',
      rows: [{ row: BASE, state: 'elsewhere', result: 'נוסף לבקשת הזיכוי', current: true, checked: false, roving: false }],
      elsewhereText: 'כבר הוחלט ע״י מנהל · 21.10.2026 10:00 · נוסף לבקשת הזיכוי',
      position: null,
    });
    const html = panel(away);
    expect(text(byTestId(html, 'desk-pill-severity'))).toBe('נוסף לבקשת הזיכוי');
    expect(text(byTestId(html, 'desk-position'))).toBe('הוחלט');
  });

  it('a capped claim: the note says why with its basis, and the primary is described by it', () => {
    const capped = row({ id: 'r-cap', deltaAmount: '150.00', expectedValue: '10.0000', actualValue: '25.0000', qtyBilled: '10.000', qtyOrdered: '10.000', billedUnit: 'יח׳', orderedUnit: 'יח׳', unitPriceExpected: '10.0000', unitPriceBilled: '25.0000', claimAgorot: 11800 });
    const html = panel(ctl(capped));
    const note = byTestId(html, 'desk-claim-note');
    expect(note).toMatch(/^<p id="desk-claim-note"/);
    expect(text(note)).toBe('עד סכום החשבונית: 118.00 ₪ מתוך פער של 150.00 ₪, לפני מע״מ');
    expect(byTestId(html, 'decide-approve')).toContain('aria-describedby="desk-claim-note"');
    expect(text(byTestId(html, 'decide-approve'))).toMatch(/^בקשת זיכוי · 118\.00 ₪/);
  });

  it('a ₪0 claim is never printed: "בקשת זיכוי" alone, and the note says why (R5)', () => {
    const html = panel(ctl(row({ id: 'r-zero', claimAgorot: 0 })));
    const approve = byTestId(html, 'decide-approve');
    expect(text(approve).replace(/1$/, '')).toBe('בקשת זיכוי'); // the key cap "1" is aria-hidden
    expect(approve).not.toContain('0.00');
    expect(approve).not.toContain('<bdi');
    expect(text(byTestId(html, 'desk-claim-note'))).toBe('בחשבונית הזו אין כרגע סכום פתוח לבקשת זיכוי');
    expect(approve).toContain('aria-describedby="desk-claim-note"');
  });

  it('a claim equal to |Δ| has no note and no description', () => {
    const html = panel(ctl(BASE));
    expect(byTestId(html, 'desk-claim-note')).toBe('');
    expect(byTestId(html, 'decide-approve')).not.toContain('aria-describedby');
  });

  it('the effect line on claim rows only', () => {
    expect(text(byTestId(panel(ctl(BASE)), 'desk-effect'))).toBe('החשבונית לא סומנה כשולמה, ובקשת הזיכוי תקוזז בתשלום');
    expect(text(byTestId(panel(ctl(row({ invoiceStatus: 'paid' }))), 'desk-effect'))).toBe('החשבונית סומנה כשולמה, ובקשת הזיכוי תישלח לספק');
    expect(byTestId(panel(ctl(ROWS.QTY_SHORT)), 'desk-effect')).toBe('');
  });

  it('a pointer move animates the body only through motion tokens; keys never animate', () => {
    expect(classOf(panel(ctl(BASE, { motion: 'next' })), 'data-testid="approval-evidence"')).toContain('motion-safe:duration-short');
    expect(classOf(panel(ctl(BASE)), 'data-testid="approval-evidence"')).not.toContain('motion-safe');
  });

  it('no current gap: the empty panel keeps a level-2 heading, never an <h2> inside a <p> (P11e)', () => {
    const html = panel(ctl(null));
    const empty = byTestId(html, 'approvals-empty');
    expect(empty).toContain('data-desk-empty=""');
    expect(outer(empty, 'role="heading"')).toMatch(/^<span role="heading" aria-level="2">הכול מטופל<\/span>$/);
    expect(empty).not.toMatch(/<p[^>]*>(?:(?!<\/p>).)*<h2/s);
    expect(empty).not.toContain('data-record');
    expect(byTestId(html, 'decision-bar')).toBe(''); // no gap and no toast: no bar
  });

  it('no current gap while the next page loads: the evidence shape, never "הכול מטופל"', () => {
    const html = panel(ctl(null, { loadingNext: true, hasMore: true, loadingMore: true }));
    expect(byTestId(html, 'approvals-empty')).toBe('');
    expect(html).toContain('aria-busy="true"');
  });
});

// ── the documents ─────────────────────────────────────────────────────────────────────────────

describe('the documents block', () => {
  it('ready: the hit line first, marked for screen readers, with "and N more lines"; the receipt with its start', () => {
    const html = panel(ctl(BASE));
    const paper = byTestId(html, 'desk-docs-paper');
    const hit = outer(paper, 'data-testid="desk-paper-hit"');
    expect(hit).toContain('aria-current="true"');
    expect(hit).toContain('<span class="sr-only">השורה של הפער</span>');
    expect(text(hit)).toContain('בירה מהחבית');
    expect(text(hit)).toContain('575.00 ₪');
    expect(text(hit)).toContain('1,150.00 ₪');
    expect(paper.indexOf('desk-paper-hit')).toBeLessThan(paper.indexOf('סודה'));
    expect(text(paper)).toContain('ועוד 4 שורות');
    expect(text(paper)).toContain('לפני מע״מ');
    const receipt = byTestId(html, 'desk-docs-receipt');
    expect(text(receipt)).toContain('התחלה');
    expect(receipt).toContain('<time');
  });

  it('loading: three fixed slots — the row\'s own line at once, two delayed skeletons that never flash (R12)', () => {
    const html = panel(ctl(BASE), { doc: { status: 'loading', own: HIT } });
    const paper = byTestId(html, 'desk-docs-paper');
    expect(byTestId(paper, 'desk-paper-hit')).not.toBe('');
    expect(count(outer(paper, '<tbody'), /<tr/g)).toBe(3);
    expect(count(paper, /motion-essential motion-reduce:duration-0/g)).toBe(2);
    expect(count(paper, /\[@starting-style\]:opacity-0/g)).toBe(2);
  });

  it('error: the hit line only, then "did not load" and a retry', () => {
    const html = panel(ctl(BASE), { doc: { status: 'error', own: HIT, retry: noop } });
    const paper = byTestId(html, 'desk-docs-paper');
    expect(count(outer(paper, '<tbody'), /<tr/g)).toBe(1);
    expect(text(paper)).toContain('שורות החשבונית לא נטענו');
    expect(text(paper)).toContain('נסו שוב');
  });

  it('a scanned invoice: the photo behind a closed disclosure, loaded lazily; the link goes to the gap\'s line (P4)', () => {
    const html = panel(ctl(row({ hasScan: true })));
    const photo = byTestId(html, 'desk-docs-photo');
    expect(photo).toMatch(/^<details data-testid="desk-docs-photo" class="group\/photo mt-2.5">/);
    expect(photo).not.toMatch(/^<details[^>]*\sopen/);
    const img = outer(photo, '<img');
    expect(img).toContain('src="/scans/inv-1/file"');
    expect(img).toContain('loading="lazy"');
    expect(img).toContain('alt="צילום החשבונית"');
    const link = outer(byTestId(html, 'desk-docs-paper'), 'href="/dashboard/invoices/inv-1');
    expect(link).toContain('href="/dashboard/invoices/inv-1#line-line-1"');
    expect(text(link)).toBe('פתחו את החשבונית המלאה');
    expect(byTestId(panel(ctl(BASE)), 'desk-docs-photo')).toBe(''); // no scan, no placeholder
  });

  it('the receipt counts only what the row carries; no receipt is said once the document is known', () => {
    expect(text(byTestId(panel(ctl(ROWS.QTY_OVER)), 'desk-docs-receipt'))).toContain('נספר6.5 ק״ג');
    const none = panel(ctl(BASE), { doc: { ...READY, grId: null, grReceivedAt: null } as GapDocument });
    expect(text(byTestId(none, 'desk-docs-receipt'))).toContain('אין קבלת סחורה מקושרת');
  });
});

// ── the decision bar ────────────────────────────────────────────────────────────────────────────

describe('the decision bar variants', () => {
  const manager = (r: QueueItem) => row({ ...r, requiredRole: 'manager', waitingOn: 'manager' });
  const primaries = (html: string) => html.match(/<(?:button|a)\b[^>]*data-desk-primary=""[^>]*>/g) ?? [];

  it('claim: exactly one filled primary (the claim with its amount), "שלמו כפי שחויב" secondary, key caps 1 · 2', () => {
    const html = bar(ctl(BASE));
    expect(byTestId(html, 'decision-bar')).toContain('data-variant="claim"');
    expect(byTestId(html, 'decision-bar')).toContain('data-pane="decision"');
    expect(primaries(html)).toHaveLength(1);
    expect(classOf(html, 'data-testid="decide-approve"')).toContain('bg-primary-bold');
    expect(classOf(html, 'data-testid="decide-reject"')).not.toContain('bg-primary-bold');
    expect(text(byTestId(html, 'decide-approve'))).toBe('בקשת זיכוי · 104.80 ₪1');
    expect(text(byTestId(html, 'decide-reject'))).toBe('שלמו כפי שחויב2');
    expect(byTestId(html, 'decide-approve')).toContain('aria-keyshortcuts="1"');
    expect(byTestId(html, 'decide-reject')).toContain('aria-keyshortcuts="2"');
    // the claim button's first <bdi> is the money (one text node: the W1-07 ₪ checks)
    expect(byTestId(html, 'decide-approve')).toMatch(/<bdi class="num whitespace-nowrap"[^>]*>[^<]*104\.80[^<]*<\/bdi>/);
    expect(text(byTestId(html, 'desk-next-line'))).toBe('אחרי ההחלטה עוברים לבא בתור, נשארו עוד 3');
    expect(byTestId(html, 'decide-escalate')).toBe(''); // the owner never escalates
  });

  it('duplicate: hold the copy (no amount) · pay, it is not a duplicate', () => {
    const html = bar(ctl(ROWS.DUPLICATE_INVOICE));
    expect(byTestId(html, 'decision-bar')).toContain('data-variant="duplicate"');
    expect(text(byTestId(html, 'decide-approve'))).toBe('אל תשלמו את העותק1');
    expect(text(byTestId(html, 'decide-reject'))).toBe('שלמו · זו לא כפולה2');
    expect(primaries(html)).toHaveLength(1);
  });

  it('review: one secondary "סמנו כנבדק" as the primary target, and the quiet escalate for a manager', () => {
    const html = bar(ctl(manager(ROWS.QTY_SHORT)), { viewerRole: 'manager' });
    expect(byTestId(html, 'decision-bar')).toContain('data-variant="review"');
    expect(text(byTestId(html, 'decide-review'))).toBe('סמנו כנבדק1');
    expect(byTestId(html, 'decide-review')).toContain('data-desk-primary=""');
    expect(classOf(html, 'data-testid="decide-review"')).not.toContain('bg-primary-bold');
    expect(byTestId(html, 'decide-reject')).toBe('');
    expect(text(byTestId(html, 'decide-escalate'))).toBe('העבירו לבעלים3');
    expect(byTestId(html, 'decide-escalate')).toContain('aria-keyshortcuts="3"');
  });

  it('link: the invoice link carries key 1 (P11a), and the escalate stays for a manager (P11b)', () => {
    const html = bar(ctl(manager(ROWS.UNORDERED_ARRIVAL)), { viewerRole: 'manager' });
    const link = byTestId(html, 'decide-link');
    expect(link).toMatch(/^<a /);
    expect(link).toContain('href="/dashboard/invoices/inv-1"');
    expect(link).toMatch(/<kbd aria-hidden="true" data-kbd=""[^>]*>1<\/kbd>/);
    expect(link).toContain('data-desk-primary=""');
    expect(byTestId(html, 'decide-escalate')).not.toBe('');
  });

  it('conflict (decided elsewhere): the note and "הסתירו", no decision and no next line', () => {
    const html = bar(ctl(BASE, { currentState: 'elsewhere', elsewhereText: 'כבר הוחלט ע״י מנהל · נוסף לבקשת הזיכוי' }), { viewerRole: 'manager' });
    expect(byTestId(html, 'decision-bar')).toContain('data-variant="conflict"');
    expect(outer(html, 'data-testid="row-note"')).toMatch(/^<p role="status" data-testid="row-note"/);
    expect(text(byTestId(html, 'row-note'))).toBe('כבר הוחלט ע״י מנהל · נוסף לבקשת הזיכוי');
    expect(text(byTestId(html, 'row-hide'))).toBe('הסתירו');
    expect(html).not.toMatch(/data-testid="decide-/);
    expect(byTestId(html, 'desk-next-line')).toBe('');
  });

  const BLOCK: DecisionBlockText = { title: 'שאלה על העמוד', body: 'יש עמוד בלי תשובה', cta: 'לתיבת השאלות', href: '/dashboard/inbox/compare?invoice=inv-1' };

  it('blocked (#190): the page-question note with its link replaces claim + pay; the quiet escalate stays (P13)', () => {
    const html = bar(ctl(manager(BASE)), { viewerRole: 'manager', blocked: BLOCK });
    expect(byTestId(html, 'decision-bar')).toContain('data-variant="blocked"');
    const note = byTestId(html, 'dq-page-question');
    expect(note).toMatch(/^<div role="note" data-testid="dq-page-question"/);
    expect(text(note)).toContain('שאלה על העמוד');
    expect(note).toContain('href="/dashboard/inbox/compare?invoice=inv-1"');
    expect(byTestId(html, 'decide-approve')).toBe('');
    expect(byTestId(html, 'decide-reject')).toBe('');
    expect(byTestId(html, 'decide-escalate')).not.toBe('');
    expect(byTestId(html, 'desk-next-line')).toBe('');
    expect(primaries(html)).toHaveLength(1);
    expect(classOf(html, 'data-desk-primary=""')).toContain('bg-primary-bold');
  });

  it('blockText is #190\'s seam: no block today', () => {
    expect(blockText(null, ((k: string) => k) as never)).toBeNull();
    expect(blockText({ kind: 'pageQuestion', invoiceId: 'inv-1' }, ((k: string) => k) as never)).toBeNull();
  });

  it('a selection at ≥1280: the BatchBar has the one filled primary, so no bar primary is filled (R13)', () => {
    const selected = { selection: { ids: new Set(['r-x']), rows: [], sumAgorot: 0, disabled: false, reason: null, note: null, busy: false } };
    for (const html of [bar(ctl(BASE, selected)), bar(ctl(ROWS.DUPLICATE_INVOICE, selected)), bar(ctl(BASE, selected), { blocked: BLOCK })]) {
      const list = primaries(html);
      expect(list.length).toBeGreaterThan(0);
      for (const p of list) expect(p).not.toContain('bg-primary-bold');
    }
    // below 1280 the selection is cleared by the controller; the bar never steps down there
    expect(classOf(bar(ctl(BASE, selected), { wide: false }), 'data-testid="decide-approve"')).toContain('bg-primary-bold');
  });

  it('the reasons row belongs to its own gap only (R9)', () => {
    expect(byTestId(bar(ctl(BASE, { asking: { id: 'r-other', origin: 'bar' } })), 'waive-reasons')).toBe('');
    const html = bar(ctl(BASE, { asking: { id: BASE.id, origin: 'bar' } }));
    const reasons = byTestId(html, 'waive-reasons');
    expect(reasons).toMatch(/^<div id="desk-reasons" role="group" aria-labelledby="desk-reasons-cost desk-reasons-q"/);
    expect(byTestId(html, 'decide-pair')).toBe(''); // the row replaces the bar's content
  });

  it('the reasons row: cost line with its basis, the question, the chips (first button first), then "חזרה"', () => {
    const html = bar(ctl(ROWS.QTY_OVER, { asking: { id: ROWS.QTY_OVER.id, origin: 'bar' } }));
    const reasons = byTestId(html, 'waive-reasons');
    expect(text(byTestId(reasons, 'desk-cost-line'))).toBe('תשלמו לירקות השרון 38.70 ₪ לפני מע״מ על 3 ק״ג שלא התקבלו.');
    const firstButton = reasons.indexOf('<button');
    expect(reasons.slice(firstButton)).toMatch(/^<button type="button" data-reason-chip=""/);
    expect(count(reasons, /data-reason-chip=""/g)).toBe(5);
    expect(text(reasons)).toContain('הגיע בפועל, הקבלה שגויה');
    expect(reasons.indexOf('data-testid="reasons-back"')).toBeGreaterThan(reasons.lastIndexOf('data-reason-chip'));
    expect(byTestId(reasons, 'reasons-back')).toContain('aria-keyshortcuts="Escape"');
    expect(byTestId(reasons, 'reasons-back')).not.toContain('aria-expanded');
    // a VAT gap below the rate never reads "מעל" (R4)
    const vat = byTestId(bar(ctl(ROWS.VAT_MISMATCH, { asking: { id: ROWS.VAT_MISMATCH.id, origin: 'bar' } })), 'desk-cost-line');
    expect(text(vat)).toBe('המע״מ בחשבונית נמוך מהשיעור ב־1.70 ₪.');
  });

  it('single keys off: no key cap and no aria-keyshortcuts anywhere, except "חזרה"\'s Escape', () => {
    const off = bar(ctl(manager(BASE)), { singleKeys: false, viewerRole: 'manager' });
    expect(byTestId(off, 'decide-escalate')).not.toBe(''); // the three buttons are all there
    expect(off).not.toMatch(/data-kbd=""/);
    expect(off).not.toContain('aria-keyshortcuts');
    const asking = bar(ctl(BASE, { asking: { id: BASE.id, origin: 'bar' } }), { singleKeys: false });
    expect(count(asking, /aria-keyshortcuts=/g)).toBe(1);
    expect(byTestId(asking, 'reasons-back')).toContain('aria-keyshortcuts="Escape"');
    expect(count(asking, /data-kbd=""/g)).toBe(1); // Esc always works
  });

  it('the landing (single): the narrow view at every width — no xl: class anywhere in the bar; caps hidden by CSS', () => {
    for (const c of [ctl(BASE), ctl(BASE, { asking: { id: BASE.id, origin: 'bar' } }), ctl(manager(ROWS.QTY_SHORT))]) {
      const html = byTestId(bar(c, { mode: 'single', viewerRole: 'manager' }), 'decision-bar');
      expect(html).not.toBe('');
      expect(html).not.toContain('xl:');
      expect(classOf(html, 'data-testid="decision-bar"')).toContain('[&_[data-kbd]]:hidden');
    }
    const body = byTestId(panel(ctl(BASE), { mode: 'single' }), 'approval-evidence');
    expect(byTestId(body, 'match-table')).not.toContain('xl:');
    expect(text(byTestId(bar(ctl(BASE), { mode: 'single' }), 'desk-next-line'))).toBe('אחרי ההחלטה נשארו עוד 3 פערים בחשבונית');
  });

  it('notes: a status line for a changed amount (with its basis), an alert with retry for an error, never a red ₪', () => {
    const changed = bar(ctl(BASE, { note: { kind: 'amountChanged', amountAgorot: 9000 } }));
    expect(changed).toMatch(/<p role="status"[^>]*>/);
    expect(text(outer(changed, 'role="status"'))).toBe('הסכום לבקשת הזיכוי השתנה ל־90.00 ₪ לפני מע״מ, בדקו ואשרו שוב');
    const error = bar(ctl(BASE, { note: { kind: 'error' } }));
    const alert = outer(error, 'role="alert"');
    expect(text(alert)).toBe('ההחלטה לא נשמרה. נסו שוב.נסו שוב');
    expect(alert).not.toMatch(/\d\.\d{2}/);
    expect(byTestId(error, 'decide-approve')).not.toMatch(/\sdisabled=""|aria-busy/); // the primary stays enabled
    expect(text(outer(bar(ctl(BASE, { note: { kind: 'batchError', text: 'השרת סירב לאישור ודבר לא השתנה' } })), 'role="alert"'))).toBe(
      'השרת סירב לאישור ודבר לא השתנה',
    );
  });

  it('the toast sits in the bar below 1280 and on the landing; at the desk it belongs to the queue column', () => {
    const undo = { text: 'נוסף לבקשת הזיכוי · 104.80 ₪ לפני מע״מ', sentAt: 1_000, capAt: 13_000, instant: false, failed: false, busy: false, ids: [BASE.id], bulk: false };
    const narrow = bar(ctl(BASE, { undo }), { wide: false });
    const toast = byTestId(narrow, 'approvals-undo');
    expect(toast).not.toBe('');
    expect(byTestId(narrow, 'decision-bar').indexOf('approvals-undo')).toBeLessThan(byTestId(narrow, 'decision-bar').indexOf('decide-pair'));
    expect(byTestId(toast, 'approvals-undo-button')).not.toContain('aria-keyshortcuts'); // no Z cap in the bar
    expect(byTestId(bar(ctl(BASE, { undo })), 'approvals-undo')).toBe('');
    // no current gap, the toast alone keeps the bar (the landing's last decision)
    expect(byTestId(bar(ctl(null, { undo }), { mode: 'single', wide: false }), 'approvals-undo')).not.toBe('');
  });
});

// ── "approve the whole invoice" ───────────────────────────────────────────────────────────────

describe('approve the whole invoice (§5.8)', () => {
  const a = row({ id: 'g-a', severity: 'warn', claimAgorot: 10000 });
  const b = row({ id: 'g-b', severity: 'warn', claimAgorot: 5000, productName: 'שמן קנולה' });
  const group = (rows: QueueItem[]) => ctl(rows[0]!, { live: rows, siblings: rows });

  it('qualifying invoice: a secondary button with the Σ, the basis beside it (outside the button)', () => {
    const html = panel(group([a, b]));
    const box = byTestId(html, 'desk-group');
    expect(text(byTestId(box, 'desk-group-more'))).toBe('עוד פער אחד בחשבונית');
    const button = byTestId(box, 'group-approve');
    expect(text(button)).toBe('אשרו את כל החשבונית · 150.00 ₪');
    expect(classOf(box, 'data-testid="group-approve"')).not.toContain('bg-primary-bold');
    expect(button).not.toContain('לפני מע״מ');
    expect(text(box)).toContain('לפני מע״מ');
    expect(byTestId(box, 'group-why')).toBe('');
  });

  it('a block row or a VAT gap: one line says why, no button (R6)', () => {
    const blocking = text(byTestId(panel(group([a, row({ id: 'g-c', severity: 'block' })])), 'group-why'));
    expect(blocking).toBe('יש בחשבונית פער חוסם: החליטו על כל פער לבד');
    const vat = byTestId(panel(group([a, row({ ...ROWS.VAT_MISMATCH, id: 'g-v' })])), 'desk-group');
    expect(text(byTestId(vat, 'group-why'))).toBe('יש בחשבונית פער מע״מ: החליטו על כל פער לבד');
    expect(byTestId(vat, 'group-approve')).toBe('');
  });

  it('over the cap: why, with the cap; a single gap: no group at all', () => {
    const over = text(byTestId(panel(group([a, row({ id: 'g-d', claimAgorot: 15000 })])), 'group-why'));
    expect(over).toBe('מעל 200.00 ₪ לחשבונית: החליטו על כל פער לבד');
    expect(byTestId(panel(ctl(a)), 'desk-group')).toBe('');
  });
});
