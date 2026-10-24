import {
  and,
  asc,
  eq,
  goodsReceipts,
  grLines,
  inArray,
  invoiceLines,
  invoices,
  poLines,
  products,
  purchaseOrders,
  restaurants,
  sql,
  type Database,
} from '@restomatch/db';
import {
  runMatch,
  type Discrepancy,
  type GrLineInput,
  type InvoiceLineInput,
  type MatchInput,
  type PoLineInput,
} from '@restomatch/matching';
import { claimableLines, sumClaims } from '../lib/claims';
import { addCalendarDaysInTz, startOfDayInTz } from '../lib/time';
import { buildMatchInputForInvoice } from './buildMatchInput';

/**
 * Cross-match (הצלבה) of a consolidated invoice (חשבונית מרכזת / ריכוז) against
 * the month's delivery notes (תעודות משלוח = goods receipts).
 *
 * READ-ONLY: nothing is written. The consolidated invoice stays "waiting for a PO
 * link" (calm, in neither leak nor spend), so the hero / report / letters / chain
 * are unchanged — this is a proposal for a person to look at.
 *
 * How: the candidate delivery notes are the supplier's goods receipts in the
 * invoice's period that no OTHER invoice covers. Their PO + received lines are
 * folded per product into ONE multi-PO MatchInput (a consolidated invoice has one
 * line per product, summed over the deliveries) and the EXISTING engine runs on it
 * in memory — same findings, same tolerances, same ₪ rules as every other match.
 * The per-delivery-note view (which notes the invoice covers) is an allocation of
 * the billed quantity over the notes, oldest first.
 *
 * The loaders read no feature flag: the consolidated router gates them on
 * `consolidatedMatch`, and the supplier ledger calls deliveryNoteCoverage directly
 * under its own flag.
 */

/** Delivery notes from a few days before / after the invoice's month can be on it. */
export const CONSOLIDATED_EDGE_DAYS = 3;
const DEFAULT_TZ = 'Asia/Jerusalem';

export interface DeliveryNoteLineData {
  grLineId: string;
  poLineId: string | null;
  productId: string | null;
  supplierSku: string | null;
  name: string | null;
  nameEn: string | null;
  unit: string;
  qtyOrdered: number;
  qtyReceived: number;
  /** The PO's agreed unit price (before VAT). */
  poPrice: number | null;
}

export interface DeliveryNoteData {
  grId: string;
  poId: string | null;
  /** The supplier's delivery-note number (`ת.מ. <n>` on the receipt), else null. */
  number: string | null;
  /** What the person knows the order by (supplier ref / customer ref), else null. */
  poRef: string | null;
  receivedAt: Date;
  lines: DeliveryNoteLineData[];
}

export type DeliveryNoteStatus = 'covered' | 'partly' | 'not_billed';

export interface ProposalDeliveryNote {
  grId: string;
  poId: string | null;
  number: string | null;
  poRef: string | null;
  receivedAt: string;
  /** Σ received × PO price (before VAT). */
  receivedValueIls: number;
  /** Σ|Δ| of the findings on this note's lines that count as leak (itemized notes only, else 0). */
  deltaIls: number;
  status: DeliveryNoteStatus;
}

export type ProposalProductStatus = 'ok' | 'difference' | 'not_billed' | 'not_received';

export interface ProposalProduct {
  key: string;
  productId: string | null;
  name: string | null;
  nameEn: string | null;
  unit: string;
  qtyReceived: number;
  qtyBilled: number;
  /** Received-qty-weighted PO price; null when no delivery note has the product. */
  poPrice: number | null;
  /** Billed unit price (qty-weighted over the invoice's lines of the product). */
  billedPrice: number | null;
  /** Σ|Δ| of this product's findings that count as leak (same rule as the hero). */
  deltaIls: number;
  status: ProposalProductStatus;
}

export interface ProposalFinding {
  type: Discrepancy['type'];
  severity: Discrepancy['severity'];
  productId: string | null;
  /** The delivery note the finding is on, when the invoice itemizes it. */
  deliveryNoteNumber: string | null;
  expected: number | null;
  actual: number | null;
  deltaAmount: number;
  countsAsLeak: boolean;
}

export interface ConsolidatedProposal {
  invoiceId: string;
  supplierId: string | null;
  /** The invoice's own status — a settled (matched / approved / paid) ריכוז is shown for reference only. */
  invoiceStatus: string;
  periodStart: string;
  periodEnd: string;
  deliveryNotes: ProposalDeliveryNote[];
  products: ProposalProduct[];
  findings: ProposalFinding[];
  totals: {
    deliveryNotesIls: number;
    invoiceSubtotalIls: number;
    /** invoice subtotal − Σ delivery notes (before VAT; + = billed more than delivered at PO prices). */
    differenceIls: number;
    /** Engine leak of the cross-match, capped at the invoice total (the hero's per-invoice rule). */
    leakIls: number;
    invoiceTotalInclVat: number;
  };
  /** matched = nothing counts as leak; differences = something does; no_delivery_notes = nothing to cross-match. */
  status: 'matched' | 'differences' | 'no_delivery_notes';
}

const ag = (v: number) => Math.round(v * 100);
const ils = (a: number) => a / 100;

/** The hero's LEAK_FILTER (packages/charts) for an in-memory finding. */
export function countsAsLeak(d: Pick<Discrepancy, 'type' | 'severity' | 'deltaAmount'>): boolean {
  return (
    (d.severity === 'warn' || d.severity === 'block') &&
    d.type !== 'PRICE_LOWER' &&
    d.type !== 'UNORDERED_ARRIVAL' &&
    Math.abs(d.deltaAmount) > 0
  );
}

/**
 * The claimable ₪ of the cross-match, by the supplier credit letters' own rule
 * (lib/claims.ts: claimableLines / sumClaims) — so the panel and a letter can never
 * disagree on a shekel. The proposal's findings are presented as one open line
 * each on an invoice already linked (claimableLines claims nothing while an
 * invoice waits for its link, which is exactly what this proposal is about),
 * biggest |Δ| first, capped at the invoice's total like the hero.
 */
export function claimableIls(
  findings: ReadonlyArray<Pick<ProposalFinding, 'type' | 'severity' | 'countsAsLeak' | 'deltaAmount' | 'expected' | 'actual'>>,
  invoiceTotalInclVat: number,
): number {
  const lines = [...findings]
    .sort((a, b) => Math.abs(b.deltaAmount) - Math.abs(a.deltaAmount))
    .map((f, i) => ({
      discrepancyId: `proposal-${i}`,
      type: f.type,
      severity: f.severity,
      resolutionStatus: 'open',
      deltaAmount: f.deltaAmount,
      expected: f.expected,
      actual: f.actual,
      countsAsLeak: f.countsAsLeak,
      productName: null,
      productNameEn: null,
      lineDescription: null,
      lineDescriptionEn: null,
    }));
  const leakAg = lines.filter((l) => l.countsAsLeak).reduce((s, l) => s + ag(Math.abs(l.deltaAmount)), 0);
  return sumClaims(
    claimableLines({
      invoiceId: 'proposal',
      invoiceNumber: null,
      invoiceDate: null,
      status: 'parsed',
      supplierName: null,
      supplierNameEn: null,
      totalInclVat: invoiceTotalInclVat,
      leakIls: ils(Math.min(leakAg, Math.max(0, ag(invoiceTotalInclVat)))),
      pendingLink: false,
      lines,
    }),
  );
}

/** A delivery-note number in free text: `ת.מ. 61036` (Hebrew) or `DN 61036`. */
export function deliveryNoteNumberIn(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /ת\.\s?מ\.?\s*(\d+)/.exec(text) ?? /\bDN\s*#?\s*(\d+)/i.exec(text);
  return m ? m[1]! : null;
}

const productKey = (l: { productId: string | null; supplierSku?: string | null; poLineId?: string | null; unit: string }) =>
  l.productId ? `p:${l.productId}` : l.supplierSku ? `s:${l.supplierSku}` : `l:${l.poLineId ?? 'none'}`;

/** The bucket of the notes / invoice lines that don't name a delivery note. */
const POOL = '*';

/**
 * Pure: the proposal for a consolidated invoice, given its base MatchInput (invoice
 * header + lines, VAT, tolerances, baselines — no PO) and the candidate delivery
 * notes. Runs the existing engine once.
 *
 * Pairing: an invoice line that names a delivery note (`invoiceLineNotes`) is
 * matched against THAT note's line of the same product (per note × product), so a
 * price difference lands on the note it is on, to the agora. Notes no line names
 * are folded per product into one pool, billed by the lines that name no note.
 */
export function buildConsolidatedProposal(args: {
  invoiceId: string;
  supplierId: string | null;
  invoiceStatus?: string;
  periodStart: Date;
  periodEnd: Date;
  base: MatchInput;
  notes: DeliveryNoteData[];
  /** Invoice line id → the delivery-note number it bills (lines that name one). */
  invoiceLineNotes?: Map<string, string>;
  /** Display names for invoice-only products (not on any delivery note). */
  productNames?: Map<string, { name: string | null; nameEn: string | null }>;
}): ConsolidatedProposal {
  const notes = [...args.notes].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const noteNumbers = new Set(notes.map((n) => n.number).filter((x): x is string => !!x));
  const lineNotes = args.invoiceLineNotes ?? new Map<string, string>();
  // An invoice line's bucket: the note it names (when that note is a candidate), else the pool.
  const bucketOfLine = (id: string) => {
    const n = lineNotes.get(id);
    return n && noteNumbers.has(n) ? n : POOL;
  };
  const itemized = new Set(args.base.invoiceLines.map((l) => bucketOfLine(l.id)).filter((b) => b !== POOL));
  const bucketOfNote = (n: DeliveryNoteData) => (n.number && itemized.has(n.number) ? n.number : POOL);

  // ── Fold the notes' lines per bucket × product into one PO line + one received line. ──
  type Group = {
    key: string;
    bucket: string;
    productId: string | null;
    supplierSku: string | null;
    name: string | null;
    nameEn: string | null;
    unit: string;
    poLineId: string;
    grLineId: string;
    qtyReceived: number;
    pricedQty: number;
    pricedAg: number; // Σ qty × price, in agorot·qty
  };
  const groups = new Map<string, Group>();
  for (const n of notes) {
    const bucket = bucketOfNote(n);
    for (const l of n.lines) {
      const key = productKey(l);
      const gk = `${bucket}|${key}`;
      const g =
        groups.get(gk) ??
        ({
          key,
          bucket,
          productId: l.productId,
          supplierSku: l.supplierSku,
          name: l.name,
          nameEn: l.nameEn,
          unit: l.unit,
          poLineId: l.poLineId ?? l.grLineId,
          grLineId: l.grLineId,
          qtyReceived: 0,
          pricedQty: 0,
          pricedAg: 0,
        } satisfies Group);
      g.qtyReceived += l.qtyReceived;
      if (l.poPrice != null) {
        g.pricedQty += l.qtyReceived;
        g.pricedAg += ag(l.poPrice) * l.qtyReceived;
      }
      groups.set(gk, g);
    }
  }
  const priceOf = (pricedAg: number, pricedQty: number) => (pricedQty > 0 ? Math.round(pricedAg / pricedQty) / 100 : null);

  // ── The invoice side, per bucket × product (normally one line each already). ──
  const lineGroups = new Map<string, InvoiceLineInput>();
  for (const il of args.base.invoiceLines) {
    const gk = `${bucketOfLine(il.id)}|${productKey({ productId: il.productId, supplierSku: il.supplierSku ?? null, poLineId: il.id, unit: il.unit })}`;
    const prev = lineGroups.get(gk);
    if (!prev) {
      lineGroups.set(gk, il);
      continue;
    }
    const qtyBilled = prev.qtyBilled + il.qtyBilled;
    const lineTotal = ils(ag(prev.lineTotal) + ag(il.lineTotal));
    lineGroups.set(gk, {
      ...prev,
      qtyBilled,
      lineTotal,
      unitPriceBilled: qtyBilled > 0 ? Math.round((lineTotal / qtyBilled) * 10_000) / 10_000 : prev.unitPriceBilled,
    });
  }

  // The engine pairs a PO line with the FIRST unmatched invoice line of its product,
  // so order both sides the same way: the paired bucket×product groups first (in
  // note order), then the PO lines with no billed line in their bucket, then the
  // invoice lines with no delivered line in theirs.
  const groupList = [...groups.entries()];
  const paired = groupList.filter(([gk]) => lineGroups.has(gk));
  const unpaired = groupList.filter(([gk]) => !lineGroups.has(gk));
  const orderedGroups = [...paired, ...unpaired].map(([, g]) => g);
  const pairedKeys = new Set(paired.map(([gk]) => gk));
  const orderedLines = [
    ...paired.map(([gk]) => lineGroups.get(gk)!),
    ...[...lineGroups.entries()].filter(([gk]) => !pairedKeys.has(gk)).map(([, l]) => l),
  ];

  const poLineInputs: PoLineInput[] = orderedGroups.map((g) => ({
    id: g.poLineId,
    productId: g.productId,
    supplierSku: g.supplierSku,
    // The delivery notes are the reference for a ריכוז: what was delivered is what may be billed.
    qtyOrdered: g.qtyReceived,
    unit: g.unit,
    unitPriceExpected: priceOf(g.pricedAg, g.pricedQty),
  }));
  const grLineInputs: GrLineInput[] = orderedGroups.map((g) => ({
    id: g.grLineId,
    poLineId: g.poLineId,
    productId: g.productId,
    qtyReceived: g.qtyReceived,
  }));

  const input: MatchInput = {
    ...args.base,
    invoiceLines: orderedLines,
    poLines: poLineInputs,
    grLines: grLineInputs,
  };
  // One invoice for many deliveries: no single expected delivery date.
  delete (input as { expectedDeliveryDate?: Date }).expectedDeliveryDate;
  const result = runMatch(notes.length > 0 ? input : { ...input, poLines: [], grLines: [] });

  const noteOfPoLine = new Map(orderedGroups.filter((g) => g.bucket !== POOL).map((g) => [g.poLineId, g.bucket]));
  const noteOfInvoiceLine = new Map(
    [...lineGroups.entries()].filter(([gk]) => !gk.startsWith(`${POOL}|`)).map(([gk, l]) => [l.id, gk.slice(0, gk.indexOf('|'))]),
  );
  const findings: ProposalFinding[] = result.discrepancies.map((d) => ({
    type: d.type,
    severity: d.severity,
    productId: d.productId,
    deliveryNoteNumber:
      (d.poLineId ? noteOfPoLine.get(d.poLineId) : undefined) ??
      (d.invoiceLineId ? noteOfInvoiceLine.get(d.invoiceLineId) : undefined) ??
      null,
    expected: d.expected,
    actual: d.actual,
    deltaAmount: d.deltaAmount,
    countsAsLeak: countsAsLeak(d),
  }));

  // ── Per product (over all buckets): received vs billed, PO vs billed price, Δ₪. ──
  type Agg = { productId: string | null; name: string | null; nameEn: string | null; unit: string; qty: number; pricedQty: number; pricedAg: number };
  const received = new Map<string, Agg>();
  for (const g of groups.values()) {
    const a = received.get(g.key) ?? { productId: g.productId, name: g.name, nameEn: g.nameEn, unit: g.unit, qty: 0, pricedQty: 0, pricedAg: 0 };
    a.qty += g.qtyReceived;
    a.pricedQty += g.pricedQty;
    a.pricedAg += g.pricedAg;
    received.set(g.key, a);
  }
  const billed = new Map<string, { qty: number; totalAg: number; productId: string | null; unit: string }>();
  for (const [gk, il] of lineGroups) {
    const key = gk.slice(gk.indexOf('|') + 1);
    const b = billed.get(key) ?? { qty: 0, totalAg: 0, productId: il.productId, unit: il.unit };
    b.qty += il.qtyBilled;
    b.totalAg += ag(il.lineTotal);
    billed.set(key, b);
  }
  const leakByProduct = new Map<string, number>();
  const leakByNote = new Map<string, number>();
  for (const f of findings) {
    if (!f.countsAsLeak) continue;
    const a = ag(Math.abs(f.deltaAmount));
    if (f.productId) leakByProduct.set(f.productId, (leakByProduct.get(f.productId) ?? 0) + a);
    if (f.deliveryNoteNumber) leakByNote.set(f.deliveryNoteNumber, (leakByNote.get(f.deliveryNoteNumber) ?? 0) + a);
  }
  const keys = new Set([...received.keys(), ...billed.keys()]);
  const productRows: ProposalProduct[] = [...keys].map((key) => {
    const g = received.get(key);
    const b = billed.get(key);
    const productId = g?.productId ?? b?.productId ?? null;
    const names = productId ? args.productNames?.get(productId) : undefined;
    const deltaAg = productId ? (leakByProduct.get(productId) ?? 0) : 0;
    const status: ProposalProductStatus = !b
      ? 'not_billed'
      : !g
        ? 'not_received'
        : deltaAg > 0
          ? 'difference'
          : 'ok';
    return {
      key,
      productId,
      name: g?.name ?? names?.name ?? null,
      nameEn: g?.nameEn ?? names?.nameEn ?? null,
      unit: g?.unit ?? b?.unit ?? '',
      qtyReceived: g?.qty ?? 0,
      qtyBilled: b?.qty ?? 0,
      poPrice: g ? priceOf(g.pricedAg, g.pricedQty) : null,
      billedPrice: b && b.qty > 0 ? Math.round(b.totalAg / b.qty) / 100 : null,
      deltaIls: ils(deltaAg),
      status,
    };
  });
  const order: Record<ProposalProductStatus, number> = { difference: 0, not_received: 1, not_billed: 2, ok: 3 };
  productRows.sort((a, b) => order[a.status] - order[b.status] || b.deltaIls - a.deltaIls || (a.name ?? '').localeCompare(b.name ?? ''));

  // ── Per delivery note: an itemized note is covered by its own lines; the pool's
  //    billed qty is allocated over the pooled notes, oldest first. ──
  const left = new Map([...lineGroups].map(([gk, l]) => [gk, l.qtyBilled]));
  const deliveryNotes: ProposalDeliveryNote[] = notes.map((n) => {
    const bucket = bucketOfNote(n);
    let need = 0;
    let got = 0;
    let valueAg = 0;
    for (const l of n.lines) {
      const gk = `${bucket}|${productKey(l)}`;
      const avail = left.get(gk) ?? 0;
      const take = Math.min(avail, l.qtyReceived);
      left.set(gk, avail - take);
      need += l.qtyReceived;
      got += take;
      if (l.poPrice != null) valueAg += Math.round(ag(l.poPrice) * l.qtyReceived);
    }
    const status: DeliveryNoteStatus = need <= 0 || got >= need - 1e-9 ? 'covered' : got > 0 ? 'partly' : 'not_billed';
    return {
      grId: n.grId,
      poId: n.poId,
      number: n.number,
      poRef: n.poRef,
      receivedAt: n.receivedAt.toISOString(),
      receivedValueIls: ils(valueAg),
      deltaIls: ils(bucket === POOL ? 0 : (leakByNote.get(bucket) ?? 0)),
      status,
    };
  });

  const deliveryNotesAg = deliveryNotes.reduce((s, n) => s + ag(n.receivedValueIls), 0);
  const subtotalAg = ag(args.base.invoice.totalExclVat);
  const leakAg = ag(claimableIls(findings, args.base.invoice.totalInclVat));

  return {
    invoiceId: args.invoiceId,
    supplierId: args.supplierId,
    invoiceStatus: args.invoiceStatus ?? 'parsed',
    periodStart: args.periodStart.toISOString(),
    periodEnd: args.periodEnd.toISOString(),
    deliveryNotes,
    products: productRows,
    findings,
    totals: {
      deliveryNotesIls: ils(deliveryNotesAg),
      invoiceSubtotalIls: ils(subtotalAg),
      differenceIls: ils(subtotalAg - deliveryNotesAg),
      leakIls: ils(leakAg),
      invoiceTotalInclVat: args.base.invoice.totalInclVat,
    },
    status: notes.length === 0 ? 'no_delivery_notes' : leakAg > 0 ? 'differences' : 'matched',
  };
}

/** The local calendar month of `at` in `tz`, widened by CONSOLIDATED_EDGE_DAYS on both sides: [start, end). */
export function consolidatedPeriod(at: Date, tz: string = DEFAULT_TZ): { start: Date; end: Date; monthStart: Date; monthEnd: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const d = Number(parts.find((p) => p.type === 'day')!.value);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthStart = startOfDayInTz(addCalendarDaysInTz(at, -(d - 1), tz), tz);
  const monthEnd = startOfDayInTz(addCalendarDaysInTz(monthStart, daysInMonth, tz), tz);
  return {
    monthStart,
    monthEnd,
    start: startOfDayInTz(addCalendarDaysInTz(monthStart, -CONSOLIDATED_EDGE_DAYS, tz), tz),
    end: startOfDayInTz(addCalendarDaysInTz(monthEnd, CONSOLIDATED_EDGE_DAYS, tz), tz),
  };
}

/** What a consolidated invoice's parsed payload (`ocr_payload.raw`, kind 'consolidated') says. */
export interface ConsolidatedRaw {
  periodStart: string | null;
  periodEnd: string | null;
  /** The delivery-note numbers the invoice lists. */
  deliveryNoteNumbers: string[];
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: the consolidated part of an invoice's OCR payload, or null when it isn't one. */
export function readConsolidatedRaw(payload: unknown): ConsolidatedRaw | null {
  const raw = (payload as { raw?: unknown } | null | undefined)?.raw as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || raw.kind !== 'consolidated') return null;
  const date = (v: unknown) => (typeof v === 'string' && LOCAL_DATE.test(v) ? v : null);
  const notes = Array.isArray(raw.deliveryNotes) ? raw.deliveryNotes : [];
  return {
    periodStart: date(raw.periodStart),
    periodEnd: date(raw.periodEnd),
    deliveryNoteNumbers: [
      ...new Set(
        notes
          .map((n) => (n as { number?: unknown } | null)?.number)
          .map((v) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''))
          .filter((v) => /^\d+$/.test(v)),
      ),
    ],
  };
}

/** A local calendar date 'YYYY-MM-DD' → the start of that day in `tz`. */
const localDayStart = (d: string, tz: string) => startOfDayInTz(new Date(`${d}T12:00:00Z`), tz);

/**
 * The period a consolidated invoice bills: the payload's own [periodStart,
 * periodEnd] (local days, end inclusive) when it states one, else the invoice
 * date's local month ± CONSOLIDATED_EDGE_DAYS. Returned as [start, end).
 */
export function periodOfInvoice(at: Date, raw: ConsolidatedRaw | null, tz: string = DEFAULT_TZ): { start: Date; end: Date } {
  if (raw?.periodStart && raw.periodEnd && raw.periodStart <= raw.periodEnd) {
    return {
      start: localDayStart(raw.periodStart, tz),
      end: startOfDayInTz(addCalendarDaysInTz(localDayStart(raw.periodEnd, tz), 1, tz), tz),
    };
  }
  const p = consolidatedPeriod(at, tz);
  return { start: p.start, end: p.end };
}

/** The delivery-note number on a goods receipt (`ת.מ. <n>` in its notes). */
const noteNumberSql = sql<string | null>`substring(${goodsReceipts.notes} from 'ת\\.\\s?מ\\.?\\s*([0-9]+)')`;

// The correlated subqueries below spell their outer columns out ("goods_receipts"."id",
// "invoices"."id"): a bare `${table.col}` in a one-table SELECT field renders
// unqualified, and inside a subquery it would bind to the inner table.

/** "Covered by another invoice": a match run of a different invoice used this receipt or its PO. */
const coveredByOther = (restaurantId: string, invoiceId: string | null) => sql`EXISTS (
  SELECT 1 FROM match_runs mr
  WHERE mr.restaurant_id = ${restaurantId}
    ${invoiceId ? sql`AND mr.invoice_id <> ${invoiceId}` : sql``}
    AND (mr.gr_id = "goods_receipts"."id" OR (mr.po_id IS NOT NULL AND mr.po_id = "goods_receipts"."po_id"))
)`;

type LoadedNote = DeliveryNoteData & { coveredByInvoiceId: string | null };

/**
 * Load a supplier's delivery notes with their lines (PO price, names): those
 * received in [from, to), or — with `numbers` — those carrying one of these
 * delivery-note numbers, whenever received.
 */
async function loadDeliveryNotes(
  db: Database,
  restaurantId: string,
  supplierId: string,
  scope: { from: Date; to: Date } | { numbers: string[] },
  opts: { excludeCoveredExcept?: string | null; onlyUncovered?: boolean } = {},
): Promise<LoadedNote[]> {
  if ('numbers' in scope && scope.numbers.length === 0) return [];
  const grs = await db
    .select({
      id: goodsReceipts.id,
      poId: goodsReceipts.poId,
      number: noteNumberSql,
      receivedAt: goodsReceipts.receivedAt,
      sourceRef: purchaseOrders.sourceRef,
      customerRef: purchaseOrders.customerRef,
      coveredBy: sql<string | null>`(
        SELECT mr.invoice_id FROM match_runs mr
        WHERE mr.restaurant_id = ${restaurantId}
          ${opts.excludeCoveredExcept ? sql`AND mr.invoice_id <> ${opts.excludeCoveredExcept}` : sql``}
          AND (mr.gr_id = "goods_receipts"."id" OR (mr.po_id IS NOT NULL AND mr.po_id = "goods_receipts"."po_id"))
        ORDER BY mr.run_at DESC LIMIT 1
      )`,
    })
    .from(goodsReceipts)
    .innerJoin(
      purchaseOrders,
      and(eq(purchaseOrders.id, goodsReceipts.poId), eq(purchaseOrders.restaurantId, restaurantId)),
    )
    .where(
      and(
        eq(goodsReceipts.restaurantId, restaurantId),
        eq(purchaseOrders.supplierId, supplierId),
        ...('numbers' in scope
          ? [inArray(noteNumberSql, scope.numbers)]
          : [
              sql`${goodsReceipts.receivedAt} >= ${scope.from.toISOString()}::timestamptz`,
              sql`${goodsReceipts.receivedAt} < ${scope.to.toISOString()}::timestamptz`,
            ]),
        sql`${goodsReceipts.status} <> 'rejected'`,
        ...(opts.onlyUncovered ? [sql`NOT ${coveredByOther(restaurantId, opts.excludeCoveredExcept ?? null)}`] : []),
      ),
    )
    .orderBy(asc(goodsReceipts.receivedAt));
  if (grs.length === 0) return [];

  const lines = await db
    .select({
      grId: grLines.grId,
      grLineId: grLines.id,
      poLineId: grLines.poLineId,
      productId: sql<string | null>`COALESCE(${grLines.productId}, ${poLines.productId})`,
      supplierSku: poLines.supplierSku,
      unit: poLines.unit,
      qtyOrdered: poLines.qtyOrdered,
      qtyReceived: grLines.qtyReceived,
      poPrice: poLines.unitPriceExpected,
      name: products.canonicalName,
      nameEn: products.nameEn,
      rawDescription: poLines.rawDescription,
      rawDescriptionEn: poLines.rawDescriptionEn,
    })
    .from(grLines)
    .leftJoin(poLines, eq(poLines.id, grLines.poLineId))
    .leftJoin(
      products,
      and(
        eq(products.id, sql`COALESCE(${grLines.productId}, ${poLines.productId})`),
        eq(products.restaurantId, restaurantId),
      ),
    )
    .where(
      inArray(
        grLines.grId,
        grs.map((g) => g.id),
      ),
    );
  const byGr = new Map<string, DeliveryNoteLineData[]>();
  for (const l of lines) {
    const list = byGr.get(l.grId) ?? [];
    list.push({
      grLineId: l.grLineId,
      poLineId: l.poLineId,
      productId: l.productId,
      supplierSku: l.supplierSku ?? null,
      name: l.name ?? l.rawDescription ?? null,
      nameEn: l.nameEn ?? l.rawDescriptionEn ?? null,
      unit: l.unit ?? '',
      qtyOrdered: l.qtyOrdered == null ? 0 : Number(l.qtyOrdered),
      qtyReceived: Number(l.qtyReceived),
      poPrice: l.poPrice == null ? null : Number(l.poPrice),
    });
    byGr.set(l.grId, list);
  }
  return grs.map((g) => ({
    grId: g.id,
    poId: g.poId,
    number: g.number ?? null,
    poRef: g.sourceRef ?? g.customerRef ?? null,
    receivedAt: g.receivedAt,
    lines: byGr.get(g.id) ?? [],
    coveredByInvoiceId: g.coveredBy ?? null,
  }));
}

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;

/** Invoices whose latest-or-only state is "waiting for a PO link": no match run, or an open UNORDERED_ARRIVAL. */
const waitingForPoLink = (restaurantId: string) => sql`(
  NOT EXISTS (SELECT 1 FROM match_runs mr WHERE mr.invoice_id = "invoices"."id" AND mr.restaurant_id = ${restaurantId})
  OR EXISTS (
    SELECT 1 FROM match_runs mr JOIN discrepancies d ON d.match_run_id = mr.id AND d.restaurant_id = ${restaurantId}
    WHERE mr.invoice_id = "invoices"."id" AND mr.restaurant_id = ${restaurantId}
      AND d.type = 'UNORDERED_ARRIVAL' AND d.resolution_status IN ('open','escalated')
  )
)`;

/** The consolidated invoices of a supplier (payload kind 'consolidated'), with what they list. */
async function consolidatedInvoicesOf(db: Database, restaurantId: string, supplierId: string, tz: string) {
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.invoiceNumber,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      createdAt: invoices.createdAt,
      ocrPayload: invoices.ocrPayload,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        eq(invoices.supplierId, supplierId),
        sql`${invoices.ocrPayload} -> 'raw' ->> 'kind' = 'consolidated'`,
      ),
    )
    .orderBy(asc(invoices.createdAt));
  return rows.map((r) => {
    const raw = readConsolidatedRaw(r.ocrPayload)!;
    return { id: r.id, number: r.number, status: r.status, raw, period: periodOfInvoice(r.invoiceDate ?? r.createdAt, raw, tz) };
  });
}

async function timezoneOf(db: Database, restaurantId: string) {
  const [restaurant] = await db
    .select({ timezone: restaurants.timezone })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return restaurant?.timezone ?? DEFAULT_TZ;
}

/**
 * The cross-match proposal for a consolidated invoice. Null when the invoice
 * doesn't exist (in this restaurant), has no supplier or no lines, or is neither a
 * consolidated invoice (payload kind 'consolidated') nor waiting for a PO link (an
 * ordinary matched invoice has its own PO).
 *
 * The delivery notes: the ones the invoice lists by number, when it lists them;
 * else the supplier's notes in its period that no other invoice covers (by a match
 * run, or by listing them on another consolidated invoice).
 */
export async function consolidatedProposal(
  db: Database,
  restaurantId: string,
  invoiceId: string,
): Promise<ConsolidatedProposal | null> {
  const [inv] = await db
    .select({
      supplierId: invoices.supplierId,
      status: invoices.status,
      invoiceDate: invoices.invoiceDate,
      createdAt: invoices.createdAt,
      ocrPayload: invoices.ocrPayload,
      waiting: sql<boolean>`${waitingForPoLink(restaurantId)}`,
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv?.supplierId) return null;
  const raw = readConsolidatedRaw(inv.ocrPayload);
  if (!raw && !inv.waiting) return null;
  const built = await buildMatchInputForInvoice(db, restaurantId, invoiceId, { skipPoDiscovery: true });
  if (!built) return null;

  const tz = await timezoneOf(db, restaurantId);
  const period = periodOfInvoice(inv.invoiceDate ?? inv.createdAt, raw, tz);
  let notes: LoadedNote[];
  if (raw && raw.deliveryNoteNumbers.length > 0) {
    notes = await loadDeliveryNotes(db, restaurantId, inv.supplierId, { numbers: raw.deliveryNoteNumbers });
  } else {
    const listedElsewhere = new Set(
      (await consolidatedInvoicesOf(db, restaurantId, inv.supplierId, tz))
        .filter((c) => c.id !== invoiceId)
        .flatMap((c) => c.raw.deliveryNoteNumbers),
    );
    notes = (
      await loadDeliveryNotes(db, restaurantId, inv.supplierId, { from: period.start, to: period.end }, {
        excludeCoveredExcept: invoiceId,
        onlyUncovered: true,
      })
    ).filter((n) => !n.number || !listedElsewhere.has(n.number));
  }

  // Which delivery note each invoice line bills (`ת.מ. <n>` / `DN <n>` in its description).
  const lineRows = await db
    .select({ id: invoiceLines.id, d: invoiceLines.rawDescription, dEn: invoiceLines.rawDescriptionEn })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  const invoiceLineNotes = new Map<string, string>();
  for (const l of lineRows) {
    const n = deliveryNoteNumberIn(l.d) ?? deliveryNoteNumberIn(l.dEn);
    if (n) invoiceLineNotes.set(l.id, n);
  }

  // Names for products billed but on no delivery note.
  const invoiceProductIds = [
    ...new Set(built.input.invoiceLines.map((l) => l.productId).filter((p): p is string => !!p)),
  ];
  const productNames = new Map<string, { name: string | null; nameEn: string | null }>();
  if (invoiceProductIds.length > 0) {
    const rows = await db
      .select({ id: products.id, name: products.canonicalName, nameEn: products.nameEn })
      .from(products)
      .where(and(eq(products.restaurantId, restaurantId), inArray(products.id, invoiceProductIds)));
    for (const r of rows) productNames.set(r.id, { name: r.name, nameEn: r.nameEn ?? null });
  }
  return buildConsolidatedProposal({
    invoiceId,
    supplierId: inv.supplierId,
    invoiceStatus: inv.status,
    periodStart: period.start,
    periodEnd: period.end,
    base: built.input,
    notes,
    invoiceLineNotes,
    productNames,
  });
}

export type DeliveryNoteCoverageState = 'covered' | 'in_consolidated' | 'not_invoiced';

export interface DeliveryNoteCoverage {
  grId: string;
  poId: string | null;
  /** The supplier's delivery-note number (`ת.מ. <n>`), else null. */
  number: string | null;
  poRef: string | null;
  receivedAt: string;
  /** Σ received × PO price (before VAT). */
  receivedValueIls: number;
  state: DeliveryNoteCoverageState;
  /** covered → the invoice that covers it; in_consolidated → the consolidated invoice proposing it. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** The covering / proposing invoice is a consolidated one (חשבונית ריכוז). */
  consolidated: boolean;
}

/** A consolidated invoice past review covers its notes; a parsed / pending one only proposes them. */
const SETTLED_STATUSES = new Set(['matched', 'approved', 'paid']);

/**
 * Each delivery note (goods receipt) of a supplier received in [from, to) and
 * what covers it, for the supplier ledger (כרטסת). Read-only. In order:
 *   1. a consolidated invoice of the supplier that LISTS the note's number —
 *      covered once it is matched / approved / paid, else in_consolidated;
 *   2. an invoice whose match run used the receipt or its PO → covered;
 *   3. a consolidated invoice that lists no notes (or one waiting for a PO link)
 *      whose period contains it — covered / in_consolidated by the same status
 *      rule (a waiting one is always in_consolidated);
 *   4. else not_invoiced.
 */
export async function deliveryNoteCoverage(
  db: Database,
  restaurantId: string,
  supplierId: string,
  from: Date,
  to: Date,
): Promise<DeliveryNoteCoverage[]> {
  const notes = await loadDeliveryNotes(db, restaurantId, supplierId, { from, to });
  if (notes.length === 0) return [];

  const tz = await timezoneOf(db, restaurantId);
  const consolidated = await consolidatedInvoicesOf(db, restaurantId, supplierId, tz);
  const consolidatedIds = new Set(consolidated.map((c) => c.id));
  const listing = new Map<string, (typeof consolidated)[number]>();
  for (const c of consolidated) for (const n of c.raw.deliveryNoteNumbers) if (!listing.has(n)) listing.set(n, c);

  const waiting = (
    await db
      .select({ id: invoices.id, number: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate, createdAt: invoices.createdAt })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), eq(invoices.supplierId, supplierId), waitingForPoLink(restaurantId)))
      .orderBy(asc(invoices.createdAt))
  ).filter((w) => !consolidatedIds.has(w.id));
  // Period candidates: consolidated invoices that don't list their notes (their
  // stated period — one that lists them covers exactly those), then the ones
  // waiting for a link.
  const byPeriod = [
    ...consolidated.filter((c) => c.raw.deliveryNoteNumbers.length === 0).map((c) => ({ id: c.id, number: c.number, settled: SETTLED_STATUSES.has(c.status), consolidated: true, period: c.period })),
    ...waiting.map((w) => ({
      id: w.id,
      number: w.number,
      settled: false,
      consolidated: false,
      period: periodOfInvoice(w.invoiceDate ?? w.createdAt, null, tz),
    })),
  ];

  const numberOf = new Map<string, string | null>();
  const coveringIds = [...new Set(notes.map((n) => n.coveredByInvoiceId).filter((x): x is string => !!x))];
  if (coveringIds.length > 0) {
    const rows = await db
      .select({ id: invoices.id, number: invoices.invoiceNumber })
      .from(invoices)
      .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, coveringIds)));
    for (const r of rows) numberOf.set(r.id, r.number);
  }

  return notes.map((n) => {
    const valueAg = n.lines.reduce((s, l) => s + (l.poPrice == null ? 0 : Math.round(ag(l.poPrice) * l.qtyReceived)), 0);
    const base = {
      grId: n.grId,
      poId: n.poId,
      number: n.number,
      poRef: n.poRef,
      receivedAt: n.receivedAt.toISOString(),
      receivedValueIls: ils(valueAg),
    };
    const lister = n.number ? listing.get(n.number) : undefined;
    if (lister) {
      return {
        ...base,
        state: SETTLED_STATUSES.has(lister.status) ? ('covered' as const) : ('in_consolidated' as const),
        invoiceId: lister.id,
        invoiceNumber: lister.number,
        consolidated: true,
      };
    }
    if (n.coveredByInvoiceId) {
      return {
        ...base,
        state: 'covered' as const,
        invoiceId: n.coveredByInvoiceId,
        invoiceNumber: numberOf.get(n.coveredByInvoiceId) ?? null,
        consolidated: consolidatedIds.has(n.coveredByInvoiceId),
      };
    }
    const inPeriod = byPeriod.find((p) => n.receivedAt >= p.period.start && n.receivedAt < p.period.end);
    if (inPeriod) {
      return {
        ...base,
        state: inPeriod.settled ? ('covered' as const) : ('in_consolidated' as const),
        invoiceId: inPeriod.id,
        invoiceNumber: inPeriod.number,
        consolidated: inPeriod.consolidated,
      };
    }
    return { ...base, state: 'not_invoiced' as const, invoiceId: null, invoiceNumber: null, consolidated: false };
  });
}
