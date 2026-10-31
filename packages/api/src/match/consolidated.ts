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
import { isLeakType } from '@restomatch/charts';
import {
  runMatch,
  unitConversionFactor,
  type Discrepancy,
  type GrLineInput,
  type InvoiceLineInput,
  type MatchInput,
  type PoLineInput,
} from '@restomatch/matching';
import { claimableLines, sumClaims, vatBasisOf, type VatBasis } from '../lib/claims';
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
  /** Another invoice already bills this note (lists its number, or its match run used it). */
  alreadyBilledOn?: OtherInvoice | null;
}

export interface OtherInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
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
  /** Billed twice: the other invoice that already bills this note. */
  alreadyBilledOn: OtherInvoice | null;
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
  /** Billed unit price (qty-weighted over the invoice's lines of the product), scale 4. */
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
  /** Billed twice: the note is already billed on this other invoice. */
  alreadyBilledOn: OtherInvoice | null;
  /** What the amount is measured on (lib/claims.ts vatBasisOf): before VAT, incl. VAT, or a VAT amount. */
  basis: VatBasis;
  /** What the line is, for the panel / the supplier letter ("חלב 3% · 24 ליטר"). */
  productName: string | null;
  productNameEn: string | null;
  unit: string | null;
  /** The billed qty of the finding's invoice line (null when it has none). */
  qty: number | null;
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
  /** What a letter asks, capped like the claims letters: before VAT ("+ מע״מ") and incl. VAT / VAT. */
  claim: { exclIls: number; inclIls: number };
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
/** Count units written many ways (יח׳ / יחידה / pcs …) are one unit. */
const COUNT_UNITS = new Set(['יח', 'יחידה', 'יחידות', 'unit', 'units', 'pc', 'pcs', 'ea', 'each']);
const unitKey = (u: string) => {
  const n = u.trim().toLowerCase().replace(/["'.\s\u05F3\u05F4]/g, '');
  return COUNT_UNITS.has(n) ? 'unit' : n;
};
/** qty_to = qty_from × factor — 1 for the same unit (aliases included), kg↔g / l↔ml, else null. */
const convFactor = (from: string, to: string) => (unitKey(from) === unitKey(to) ? 1 : unitConversionFactor(from, to));
/** A unit price at scale 4 (NUMERIC(12,4)) → integer price units (1/100 agora). */
const p4Of = (price: number) => Math.round(price * 10_000);

/**
 * The hero's LEAK_FILTER (packages/charts) for an in-memory finding — narrowed for
 * a ריכוז: a delivered note or line the invoice does not bill (MISSING_ON_INVOICE)
 * is under-billing, not a leak (it may be on next month's invoice), and a finding
 * whose Δ is not positive never counts.
 */
export function countsAsLeak(
  d: Pick<Discrepancy, 'type' | 'severity' | 'deltaAmount'> & { expected?: number | null; actual?: number | null },
): boolean {
  // The header checks carry |Δ|: for a ריכוז only charging MORE counts — a subtotal
  // above its lines (TOTAL_MISMATCH: actual subtotal > expected Σ lines), VAT above
  // what the subtotal implies (VAT_MISMATCH: actual > expected). Under-billing is not.
  const above = d.expected == null || d.actual == null || d.actual > d.expected;
  return (
    (d.severity === 'warn' || d.severity === 'block') &&
    isLeakType(d.type) &&
    ((d.type !== 'TOTAL_MISMATCH' && d.type !== 'VAT_MISMATCH') || above) &&
    d.deltaAmount > 0
  );
}

/**
 * The claimable ₪ of the cross-match, by the supplier credit letters' own rule
 * (lib/claims.ts: claimableLines / sumClaims) — so the panel, the printed letter and
 * a claims letter can never disagree on a shekel. The proposal's findings are
 * presented as one open line each on an invoice already linked (claimableLines
 * claims nothing while an invoice waits for its link, which is exactly what this
 * proposal is about), biggest |Δ| first, capped at the invoice's total like the
 * hero — and the capped amounts are split by VAT basis (vatBasisOf): before VAT
 * (the letter asks "+ מע״מ") vs incl. VAT / a VAT amount (asked as is).
 */
export function claimSplit(
  findings: ReadonlyArray<
    Pick<ProposalFinding, 'type' | 'severity' | 'countsAsLeak' | 'deltaAmount' | 'expected' | 'actual'> &
      Partial<Pick<ProposalFinding, 'productId'>>
  >,
  invoiceTotalInclVat: number,
): { totalIls: number; exclIls: number; inclIls: number } {
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
      // A proposal has no persisted PO / invoice line ids; the product is enough for the rule.
      poLineId: null,
      invoiceLineId: null,
      productId: f.productId ?? null,
      productName: null,
      productNameEn: null,
      lineDescription: null,
      lineDescriptionEn: null,
    }));
  const leakAg = lines.filter((l) => l.countsAsLeak).reduce((s, l) => s + ag(Math.abs(l.deltaAmount)), 0);
  const claimed = claimableLines({
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
  });
  return {
    totalIls: sumClaims(claimed),
    exclIls: sumClaims(claimed.filter((c) => c.basis === 'excl')),
    inclIls: sumClaims(claimed.filter((c) => c.basis !== 'excl')),
  };
}

/** The claimable ₪ of the cross-match (claimSplit's total). */
export function claimableIls(
  findings: Parameters<typeof claimSplit>[0],
  invoiceTotalInclVat: number,
): number {
  return claimSplit(findings, invoiceTotalInclVat).totalIls;
}

/** A delivery-note number in free text: `ת.מ. 61036` (Hebrew) or `DN 61036`. */
export function deliveryNoteNumberIn(text: string | null | undefined): string | null {
  if (!text) return null;
  // A RANGE ("ת.מ. 61036-61043", "61036 עד 61043") is a month line: it bills the pool.
  if (/(?:ת\.\s?מ\.?|\bDN)\s*#?\s*\d+\s*(?:[-–—]|עד|to)\s*\d+/i.test(text)) return null;
  // So is a LIST ("ת.מ. 61036, 61037, 61038" / "61036 ו-61037").
  if (/(?:ת\.\s?מ\.?|\bDN)\s*#?\s*\d+\s*(?:[,،;/]|ו-?)\s*\d+/i.test(text)) return null;
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
  const invKey = (il: InvoiceLineInput) =>
    productKey({ productId: il.productId, supplierSku: il.supplierSku ?? null, poLineId: il.id, unit: il.unit });
  // Itemized per note × PRODUCT: an invoice line names a note, and is paired with
  // that note's line of its product — when the note has one; otherwise (or when it
  // names no candidate note) it bills the pool. A note's line is itemized only when
  // some invoice line names that note for that product, so a ריכוז that itemizes the
  // milk but bills the month's eggs in one line pairs each correctly.
  const noteProducts = new Set(notes.flatMap((n) => (n.number ? n.lines.map((l) => `${n.number}|${productKey(l)}`) : [])));
  const bucketOfLine = (il: InvoiceLineInput) => {
    const n = lineNotes.get(il.id);
    return n && noteNumbers.has(n) && noteProducts.has(`${n}|${invKey(il)}`) ? n : POOL;
  };
  const itemizedPairs = new Set(
    args.base.invoiceLines.flatMap((il) => {
      const b = bucketOfLine(il);
      return b === POOL ? [] : [`${b}|${invKey(il)}`];
    }),
  );
  const bucketOfNoteLine = (n: DeliveryNoteData, l: DeliveryNoteLineData) =>
    n.number && itemizedPairs.has(`${n.number}|${productKey(l)}`) ? n.number : POOL;

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
    pricedP4: number; // Σ qty × price, in price units (1/100 agora) · qty — no agora rounding of the price
  };
  const groups = new Map<string, Group>();
  /** A note line's group key and its qty / price in the group's unit (kg↔g, l↔ml; else its own group). */
  const placeLine = (bucket: string, l: DeliveryNoteLineData) => {
    const key = productKey(l);
    const base = groups.get(`${bucket}|${key}`);
    const factor = !base ? 1 : convFactor(l.unit, base.unit);
    if (factor == null) {
      const k = `${key}|u:${l.unit}`;
      return { gk: `${bucket}|${k}`, key: k, qty: l.qtyReceived, p4: l.poPrice == null ? null : p4Of(l.poPrice) };
    }
    return {
      gk: `${bucket}|${key}`,
      key,
      qty: l.qtyReceived * factor,
      p4: l.poPrice == null ? null : p4Of(l.poPrice) / factor,
    };
  };
  for (const n of notes) {
    for (const l of n.lines) {
      const { gk, key, qty, p4 } = placeLine(bucketOfNoteLine(n, l), l);
      const g =
        groups.get(gk) ??
        ({
          key,
          bucket: bucketOfNoteLine(n, l),
          productId: l.productId,
          supplierSku: l.supplierSku,
          name: l.name,
          nameEn: l.nameEn,
          unit: l.unit,
          poLineId: l.poLineId ?? l.grLineId,
          grLineId: l.grLineId,
          qtyReceived: 0,
          pricedQty: 0,
          pricedP4: 0,
        } satisfies Group);
      g.qtyReceived += qty;
      if (p4 != null) {
        g.pricedQty += qty;
        g.pricedP4 += p4 * qty;
      }
      groups.set(gk, g);
    }
  }
  /** The received-qty-weighted PO price, at scale 4 (₪ with 4 decimals). */
  const priceOf = (pricedP4: number, pricedQty: number) => (pricedQty > 0 ? Math.round(pricedP4 / pricedQty) / 10_000 : null);

  // ── The invoice side, per bucket × product (normally one line each already). ──
  const lineGroups = new Map<string, InvoiceLineInput>();
  for (const il of args.base.invoiceLines) {
    const gk = `${bucketOfLine(il)}|${invKey(il)}`;
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

  const pairedLineOf = new Map(paired.map(([gk, g]) => [g, lineGroups.get(gk)!]));
  const poLineInputs: PoLineInput[] = orderedGroups.map((g) => ({
    id: g.poLineId,
    productId: g.productId,
    supplierSku: g.supplierSku,
    // The delivery notes are the reference for a ריכוז: what was delivered is what may be billed.
    qtyOrdered: g.qtyReceived,
    // The same unit spelled another way (יח׳ / יחידה) is the invoice line's unit for the engine.
    unit: (() => {
      const il = pairedLineOf.get(g);
      return il && unitKey(il.unit) === unitKey(g.unit) ? il.unit : g.unit;
    })(),
    unitPriceExpected: priceOf(g.pricedP4, g.pricedQty),
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
  // A pooled product is billed as one month's total against many notes: compare
  // AMOUNTS (billed Σ line totals vs Σ received × PO price, in agorot) instead of the
  // engine's per-unit price check, whose 2% / ₪5 tolerance on a monthly AVERAGE
  // price would hide (or invent) a difference. Units billed beyond what was
  // received stay the engine's QTY_OVER (at the billed price) — not counted twice.
  // When the month's amounts say the product was NOT billed above what was delivered,
  // that decides: no QTY_OVER / price finding on it (32 @ ₪6.00 = 30 @ ₪6.40 = ₪192).
  // Only products the amount check could compare replace the engine's price finding.
  const pooled = paired.filter(([, g]) => g.bucket === POOL);
  const pooledPoLines = new Set<string>(); // compared: the amount check replaces the engine's PRICE_*
  const notAboveDelivered = new Set<string>(); // billed ≤ delivered: no QTY_OVER / PRICE_* at all
  const pooledFindings: Discrepancy[] = [];
  for (const [gk, g] of pooled) {
    const il = lineGroups.get(gk)!;
    const factor = convFactor(il.unit, g.unit);
    const avgP4 = g.pricedQty > 0 ? g.pricedP4 / g.pricedQty : null;
    if (factor == null || avgP4 == null) continue;
    const billedQty = il.qtyBilled * factor;
    const q = Math.min(billedQty, g.qtyReceived);
    if (q <= 0 || billedQty <= 0) continue;
    pooledPoLines.add(g.poLineId);
    if (g.pricedQty >= g.qtyReceived && ag(il.lineTotal) <= Math.round(g.pricedP4 / 100)) {
      notAboveDelivered.add(g.poLineId);
      continue;
    }
    const billedOnQAg = Math.round((ag(il.lineTotal) * q) / billedQty);
    const expectedAg = Math.round((q * avgP4) / 100);
    const deltaAg = billedOnQAg - expectedAg;
    if (deltaAg === 0) continue;
    pooledFindings.push({
      type: deltaAg > 0 ? 'PRICE_HIGHER' : 'PRICE_LOWER',
      severity: deltaAg > 0 ? 'warn' : 'info',
      productId: g.productId,
      poLineId: g.poLineId,
      grLineId: g.grLineId,
      invoiceLineId: il.id,
      expected: Math.round(avgP4) / 10_000,
      actual: Math.round((billedOnQAg / q) * 100) / 10_000,
      deltaAmount: ils(Math.abs(deltaAg)),
      toleranceUsed: 'pooled ריכוז: billed amount vs Σ received × PO price (agorot)',
    } as Discrepancy);
  }
  // Billed twice: a note this invoice bills that another invoice already bills —
  // the whole amount billed for it here is the difference (before VAT), on that
  // note, naming the other invoice; the note's own line findings are folded into it.
  const twiceNotes = new Map(notes.filter((n) => n.number && n.alreadyBilledOn).map((n) => [n.number!, n]));
  type TwiceFinding = Discrepancy & { alreadyBilledOn: OtherInvoice; noteNumber: string };
  const twiceFindings: TwiceFinding[] = [];
  for (const [number, n] of twiceNotes) {
    const itemizedAg = [...lineGroups.entries()]
      .filter(([gk]) => gk.startsWith(`${number}|`))
      .reduce((sum, [, l]) => sum + ag(l.lineTotal), 0);
    // Only a note this invoice's own lines bill is billed twice (never its PO value).
    const billedAg = itemizedAg;
    if (billedAg <= 0) continue;
    twiceFindings.push({
      type: 'QTY_OVER',
      severity: 'block',
      productId: null,
      poLineId: null,
      grLineId: null,
      invoiceLineId: null,
      expected: 0,
      actual: ils(billedAg),
      deltaAmount: ils(billedAg),
      toleranceUsed: 'ריכוז: a delivery note already billed on another invoice',
      alreadyBilledOn: n.alreadyBilledOn!,
      noteNumber: number,
    } as TwiceFinding);
  }
  const noteOf = (d: Discrepancy) =>
    (d.poLineId ? noteOfPoLine.get(d.poLineId) : undefined) ?? (d.invoiceLineId ? noteOfInvoiceLine.get(d.invoiceLineId) : undefined);
  const engineFindings = result.discrepancies.filter(
    (d) =>
      !((d.type === 'PRICE_HIGHER' || d.type === 'PRICE_LOWER') && d.poLineId && pooledPoLines.has(d.poLineId)) &&
      !(d.type === 'QTY_OVER' && d.poLineId && notAboveDelivered.has(d.poLineId)) &&
      !twiceNotes.has(noteOf(d) ?? ''),
  );
  const lineById = new Map([...lineGroups.values()].map((l) => [l.id, l]));
  const nameOf = (productId: string | null) => {
    if (!productId) return null;
    const g = [...groups.values()].find((x) => x.productId === productId);
    return g ? { name: g.name, nameEn: g.nameEn } : (args.productNames?.get(productId) ?? null);
  };
  // A held duplicate (DUPLICATE_INVOICE) already claims the whole invoice: its notes
  // are not ALSO billed twice, line by line — one problem, one amount.
  const heldDuplicate = engineFindings.some((d) => d.type === 'DUPLICATE_INVOICE' && countsAsLeak(d));
  const findings: ProposalFinding[] = [...engineFindings, ...pooledFindings, ...(heldDuplicate ? [] : twiceFindings)].map((d) => ({
    // A held duplicate: the DUPLICATE line alone stands — the rest of the invoice is inside it.
    basis: vatBasisOf(d.type),
    productName: nameOf(d.productId)?.name ?? null,
    productNameEn: nameOf(d.productId)?.nameEn ?? null,
    unit: (d.invoiceLineId ? lineById.get(d.invoiceLineId)?.unit : undefined) ?? null,
    qty: (d.invoiceLineId ? lineById.get(d.invoiceLineId)?.qtyBilled : undefined) ?? null,
    type: d.type,
    severity: d.severity,
    productId: d.productId,
    deliveryNoteNumber: (d as Partial<TwiceFinding>).noteNumber ?? noteOf(d) ?? null,
    alreadyBilledOn: (d as Partial<TwiceFinding>).alreadyBilledOn ?? null,
    expected: d.expected,
    actual: d.actual,
    deltaAmount: d.deltaAmount,
    countsAsLeak: countsAsLeak(d) && (!heldDuplicate || d.type === 'DUPLICATE_INVOICE'),
  }));

  // ── Per product (over all buckets): received vs billed, PO vs billed price, Δ₪. ──
  type Agg = { productId: string | null; name: string | null; nameEn: string | null; unit: string; qty: number; pricedQty: number; pricedP4: number };
  const received = new Map<string, Agg>();
  for (const g of groups.values()) {
    const a = received.get(g.key);
    // Buckets of one product share its first unit (kg↔g, l↔ml convert; others are their own key).
    const f = a ? (convFactor(g.unit, a.unit) ?? 1) : 1;
    const agg = a ?? { productId: g.productId, name: g.name, nameEn: g.nameEn, unit: g.unit, qty: 0, pricedQty: 0, pricedP4: 0 };
    agg.qty += g.qtyReceived * f;
    agg.pricedQty += g.pricedQty * f;
    agg.pricedP4 += g.pricedP4;
    received.set(g.key, agg);
  }
  const billed = new Map<string, { qty: number; totalAg: number; productId: string | null; unit: string }>();
  for (const [gk, il] of lineGroups) {
    const key = gk.slice(gk.indexOf('|') + 1);
    const unit = received.get(key)?.unit ?? il.unit;
    const f = convFactor(il.unit, unit) ?? 1;
    const b = billed.get(key) ?? { qty: 0, totalAg: 0, productId: il.productId, unit };
    b.qty += il.qtyBilled * f;
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
      poPrice: g ? priceOf(g.pricedP4, g.pricedQty) : null,
      // Scale 4, like the PO price: ₪238.50 / 100 = ₪2.385 (not ₪2.39).
      billedPrice: b && b.qty > 0 ? Math.round((b.totalAg * 100) / b.qty) / 10_000 : null,
      deltaIls: ils(deltaAg),
      status,
    };
  });
  const order: Record<ProposalProductStatus, number> = { difference: 0, not_received: 1, not_billed: 2, ok: 3 };
  productRows.sort((a, b) => order[a.status] - order[b.status] || b.deltaIls - a.deltaIls || (a.name ?? '').localeCompare(b.name ?? ''));

  // ── Per delivery note: an itemized note is covered by its own lines; the pool's
  //    billed qty is allocated over the pooled notes, oldest first. ──
  // Billed qty left per bucket × product, in the invoice line's own unit.
  const left = new Map([...lineGroups].map(([gk, l]) => [gk, l.qtyBilled]));
  const deliveryNotes: ProposalDeliveryNote[] = notes.map((n) => {
    let need = 0;
    let got = 0;
    let valueAg = 0;
    let itemizedNote = false;
    for (const l of n.lines) {
      const bucket = bucketOfNoteLine(n, l);
      if (bucket !== POOL) itemizedNote = true;
      const gk = `${bucket}|${productKey(l)}`;
      const il = lineGroups.get(gk);
      // Billed units → this note line's unit (kg↔g, l↔ml); unconvertible units never cover it.
      const f = !il ? 0 : (convFactor(il.unit, l.unit) ?? 0);
      const avail = (left.get(gk) ?? 0) * f;
      const take = Math.min(avail, l.qtyReceived);
      if (f > 0) left.set(gk, (left.get(gk) ?? 0) - take / f);
      need += l.qtyReceived;
      got += take;
      if (l.poPrice != null) valueAg += Math.round((p4Of(l.poPrice) * l.qtyReceived) / 100);
    }
    const status: DeliveryNoteStatus = need <= 0 || got >= need - 1e-9 ? 'covered' : got > 0 ? 'partly' : 'not_billed';
    return {
      grId: n.grId,
      poId: n.poId,
      number: n.number,
      poRef: n.poRef,
      receivedAt: n.receivedAt.toISOString(),
      receivedValueIls: ils(valueAg),
      deltaIls: ils((itemizedNote || n.alreadyBilledOn) && n.number ? (leakByNote.get(n.number) ?? 0) : 0),
      status,
      alreadyBilledOn: n.alreadyBilledOn ?? null,
    };
  });

  const deliveryNotesAg = deliveryNotes.reduce((s, n) => s + ag(n.receivedValueIls), 0);
  const subtotalAg = ag(args.base.invoice.totalExclVat);
  const claim = claimSplit(findings, args.base.invoice.totalInclVat);
  const leakAg = ag(claim.totalIls);

  return {
    invoiceId: args.invoiceId,
    supplierId: args.supplierId,
    invoiceStatus: args.invoiceStatus ?? 'parsed',
    periodStart: args.periodStart.toISOString(),
    periodEnd: args.periodEnd.toISOString(),
    deliveryNotes,
    products: productRows,
    findings,
    claim: { exclIls: claim.exclIls, inclIls: claim.inclIls },
    totals: {
      deliveryNotesIls: ils(deliveryNotesAg),
      invoiceSubtotalIls: ils(subtotalAg),
      differenceIls: ils(subtotalAg - deliveryNotesAg),
      leakIls: ils(leakAg),
      invoiceTotalInclVat: args.base.invoice.totalInclVat,
    },
    // Never "matched" while the invoice bills more than the notes are worth at PO prices.
    status: notes.length === 0 ? 'no_delivery_notes' : leakAg > 0 || subtotalAg > deliveryNotesAg ? 'differences' : 'matched',
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

/** An invoice dated in its month's first days may bill the month before. */
export const EARLY_MONTH_DAYS = 5;
/** Slack around a stated period when looking a listed note number up. */
export const LISTED_NOTE_SLACK_DAYS = 7;

/**
 * Pure: the periods a consolidated invoice may bill. Its stated period when it has
 * one; else its month ± CONSOLIDATED_EDGE_DAYS — and, when it is dated in the
 * month's first EARLY_MONTH_DAYS days (the 1st-of-the-month ריכוז for last month),
 * the previous month too. The caller keeps the better fit.
 */
export function candidatePeriods(at: Date, raw: ConsolidatedRaw | null, tz: string = DEFAULT_TZ): Array<{ start: Date; end: Date }> {
  const own = periodOfInvoice(at, raw, tz);
  if (raw?.periodStart && raw.periodEnd) return [own];
  const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, day: 'numeric' }).format(at));
  if (day > EARLY_MONTH_DAYS) return [own];
  const prev = consolidatedPeriod(addCalendarDaysInTz(at, -day, tz), tz);
  return [own, { start: prev.start, end: prev.end }];
}

/**
 * Pure: the proposal that fits its invoice better — the window that leaves no
 * delivered note unbilled, then the one covering the most notes; a tie keeps the
 * first (its own month). (Not the smallest |invoice − notes|: a weekly ריכוז dated
 * the 5th would pick last month's notes for the closer total.)
 */
export function betterFit(a: ConsolidatedProposal, b: ConsolidatedProposal): ConsolidatedProposal {
  // A window the invoice bills MORE than it delivered (units billed but not received
  // there) is never the better fit; then no unbilled note; then the most covered.
  const over = (p: ConsolidatedProposal) =>
    p.findings.some((f) => (f.type === 'QTY_OVER' || f.type === 'UNORDERED_ITEM') && f.deltaAmount > 0);
  const score = (p: ConsolidatedProposal) => {
    const covered = p.deliveryNotes.filter((n) => n.status === 'covered').length;
    const leftovers = p.deliveryNotes.length - covered;
    return [p.deliveryNotes.length > 0 && !over(p) ? 1 : 0, p.deliveryNotes.length > 0 && leftovers === 0 ? 1 : 0, covered] as const;
  };
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) if (sb[i] !== sa[i]) return sb[i]! > sa[i]! ? b : a;
  return a;
}

/** The delivery-note number on a goods receipt (`ת.מ. <n>` in its notes). */
const noteNumberSql = sql<string | null>`substring(${goodsReceipts.notes} from 'ת\\.\\s?מ\\.?\\s*([0-9]+)')`;

// The correlated subqueries below spell their outer columns out ("goods_receipts"."id",
// "invoices"."id"): a bare `${table.col}` in a one-table SELECT field renders
// unqualified, and inside a subquery it would bind to the inner table.

/**
 * "Covered by another invoice": a match run of a different invoice used THIS receipt
 * (gr_id) — unless both name their products and none overlaps (an unrelated
 * invoice paired to the PO by discovery does not bill this note). Unmapped lines
 * can't tell, so they still count.
 */
const coveredByOther = (restaurantId: string, invoiceId: string | null) => sql`EXISTS (
  SELECT 1 FROM match_runs mr
  WHERE mr.restaurant_id = ${restaurantId}
    ${invoiceId ? sql`AND mr.invoice_id <> ${invoiceId}` : sql``}
    AND mr.gr_id = "goods_receipts"."id"
    -- …unless both sides name their products and none overlaps: an unrelated
    -- invoice paired to the note's PO by discovery bills something else.
    AND NOT (
      EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = mr.invoice_id AND il.product_id IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM gr_lines gl LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
        WHERE gl.gr_id = "goods_receipts"."id" AND COALESCE(gl.product_id, pl.product_id) IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM invoice_lines il
        JOIN gr_lines gl ON gl.gr_id = "goods_receipts"."id"
        LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
        WHERE il.invoice_id = mr.invoice_id AND il.product_id = COALESCE(gl.product_id, pl.product_id)
      )
    )
)`;

type LoadedNote = DeliveryNoteData & { coveredByInvoiceId: string | null };

/**
 * Load a supplier's delivery notes with their lines (PO price, names) received in
 * [from, to) — with `numbers`, only those carrying one of these delivery-note
 * numbers (a supplier's numbering wraps over years: the window keeps it local).
 */
async function loadDeliveryNotes(
  db: Database,
  restaurantId: string,
  supplierId: string,
  scope: { from: Date; to: Date; numbers?: string[] },
  opts: { excludeCoveredExcept?: string | null; onlyUncovered?: boolean } = {},
): Promise<LoadedNote[]> {
  if (scope.numbers && scope.numbers.length === 0) return [];
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
          AND mr.gr_id = "goods_receipts"."id"
          AND NOT (
            EXISTS (SELECT 1 FROM invoice_lines il WHERE il.invoice_id = mr.invoice_id AND il.product_id IS NOT NULL)
            AND EXISTS (
              SELECT 1 FROM gr_lines gl LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
              WHERE gl.gr_id = "goods_receipts"."id" AND COALESCE(gl.product_id, pl.product_id) IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM invoice_lines il
              JOIN gr_lines gl ON gl.gr_id = "goods_receipts"."id"
              LEFT JOIN po_lines pl ON pl.id = gl.po_line_id
              WHERE il.invoice_id = mr.invoice_id AND il.product_id = COALESCE(gl.product_id, pl.product_id)
            )
          )
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
        ...(scope.numbers ? [inArray(noteNumberSql, scope.numbers)] : []),
        sql`${goodsReceipts.receivedAt} >= ${scope.from.toISOString()}::timestamptz`,
        sql`${goodsReceipts.receivedAt} < ${scope.to.toISOString()}::timestamptz`,
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
    const flags = (r.ocrPayload?.raw ?? {}) as { duplicateOf?: unknown; supersededBy?: unknown; credited?: unknown };
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      createdAt: r.createdAt,
      raw,
      period: periodOfInvoice(r.invoiceDate ?? r.createdAt, raw, tz),
      // A disputed, held-duplicate, superseded or credited ריכוז bills nothing: it
      // never makes another invoice's note "billed twice" nor hides a note.
      active: r.status !== 'disputed' && !flags.duplicateOf && !flags.supersededBy && !flags.credited,
    };
  });
}

/** A delivery-note number matches another invoice's only within this many days (numbering wraps). */
export const NUMBER_MATCH_DAYS = 30;
/** Pure: do two periods lie within NUMBER_MATCH_DAYS of each other? */
export function periodsNear(a: { start: Date; end: Date }, b: { start: Date; end: Date }, days = NUMBER_MATCH_DAYS): boolean {
  const slack = days * 86_400_000;
  return a.start.getTime() - slack < b.end.getTime() && b.start.getTime() - slack < a.end.getTime();
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
 * doesn't exist (in this restaurant), has no supplier or no lines, or is not a
 * consolidated invoice (payload kind 'consolidated'). An ordinary invoice waiting
 * for its PO link gets none: against a whole month's notes it would only invent
 * findings.
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
    })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.restaurantId, restaurantId)))
    .limit(1);
  if (!inv?.supplierId) return null;
  const raw = readConsolidatedRaw(inv.ocrPayload);
  if (!raw) return null;
  const built = await buildMatchInputForInvoice(db, restaurantId, invoiceId, { skipPoDiscovery: true });
  if (!built) return null;

  const tz = await timezoneOf(db, restaurantId);
  const at = inv.invoiceDate ?? inv.createdAt;
  const others = (await consolidatedInvoicesOf(db, restaurantId, inv.supplierId, tz)).filter((c) => c.id !== invoiceId);

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
  const build = (period: { start: Date; end: Date }, notes: DeliveryNoteData[]) =>
    buildConsolidatedProposal({
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

  if (raw.deliveryNoteNumbers.length > 0) {
    // The notes it lists, looked up around its period — for an early-month invoice
    // without a stated period, its own month and the one before, keeping the window
    // that finds the most listed notes (ties: its own month) — and flagged when
    // another active, EARLIER invoice already lists them near that period, or another
    // invoice's match run used the very receipt.
    let period = periodOfInvoice(at, raw, tz);
    let loaded: LoadedNote[] = [];
    for (const p of candidatePeriods(at, raw, tz)) {
      const found = await loadDeliveryNotes(
        db,
        restaurantId,
        inv.supplierId,
        {
          numbers: raw.deliveryNoteNumbers,
          from: addCalendarDaysInTz(p.start, -LISTED_NOTE_SLACK_DAYS, tz),
          to: addCalendarDaysInTz(p.end, LISTED_NOTE_SLACK_DAYS, tz),
        },
        { excludeCoveredExcept: invoiceId },
      );
      if (found.length > loaded.length) {
        period = p;
        loaded = found;
      }
    }
    const listedBy = new Map<string, OtherInvoice>();
    const earlier = others.filter(
      (o) => o.active && periodsNear(o.period, period) && (o.createdAt < inv.createdAt || (+o.createdAt === +inv.createdAt && o.id < invoiceId)),
    );
    for (const c of earlier) {
      for (const n of c.raw.deliveryNoteNumbers) if (!listedBy.has(n)) listedBy.set(n, { invoiceId: c.id, invoiceNumber: c.number });
    }
    const coveringIds = [...new Set(loaded.map((n) => n.coveredByInvoiceId).filter((x): x is string => !!x))];
    const numberOf = new Map<string, string | null>();
    if (coveringIds.length > 0) {
      const rows = await db
        .select({ id: invoices.id, number: invoices.invoiceNumber })
        .from(invoices)
        .where(and(eq(invoices.restaurantId, restaurantId), inArray(invoices.id, coveringIds)));
      for (const r of rows) numberOf.set(r.id, r.number);
    }
    const notes = loaded.map((n) => ({
      ...n,
      alreadyBilledOn:
        (n.number ? listedBy.get(n.number) : undefined) ??
        (n.coveredByInvoiceId ? { invoiceId: n.coveredByInvoiceId, invoiceNumber: numberOf.get(n.coveredByInvoiceId) ?? null } : null),
    }));
    return build(period, notes);
  }

  // No list: the supplier's notes in its period that no other invoice covers (by a
  // match run, or by listing them) — for an early-month invoice without a stated
  // period, its own month and the one before, whichever fits better.
  let best: ConsolidatedProposal | null = null;
  for (const period of candidatePeriods(at, raw, tz)) {
    // Notes another active ריכוז near this period lists are its, not this one's.
    const listedElsewhere = new Set(
      others.filter((c) => c.active && periodsNear(c.period, period)).flatMap((c) => c.raw.deliveryNoteNumbers),
    );
    const notes = (
      await loadDeliveryNotes(db, restaurantId, inv.supplierId, { from: period.start, to: period.end }, {
        excludeCoveredExcept: invoiceId,
        onlyUncovered: true,
      })
    ).filter((n) => !n.number || !listedElsewhere.has(n.number));
    const p = build(period, notes);
    best = best ? betterFit(best, p) : p;
  }
  return best;
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
 *   3. a consolidated invoice that lists no notes whose period contains it —
 *      covered / in_consolidated by the same status rule (an ordinary invoice
 *      waiting for its PO link has no period and covers nothing);
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
  // A ריכוז lists a note by number — but numbering wraps, so only one whose period
  // lies within NUMBER_MATCH_DAYS of the note's date lists THIS note.
  const listers = new Map<string, Array<(typeof consolidated)[number]>>();
  for (const c of consolidated) {
    for (const n of c.raw.deliveryNoteNumbers) listers.set(n, [...(listers.get(n) ?? []), c]);
  }
  const listerOf = (number: string, at: Date) =>
    (listers.get(number) ?? []).find((c) => c.active && periodsNear(c.period, { start: at, end: at }));

  // Period candidates: consolidated invoices that don't list their notes (their
  // stated period — one that lists them covers exactly those). An ordinary invoice
  // waiting for its PO link has no billing period and covers nothing: counting it
  // would hide a note nobody has billed.
  const byPeriod = consolidated
    .filter((c) => c.raw.deliveryNoteNumbers.length === 0)
    .map((c) => ({ id: c.id, number: c.number, settled: SETTLED_STATUSES.has(c.status), consolidated: true, period: c.period }));

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
    const valueAg = n.lines.reduce((s, l) => s + (l.poPrice == null ? 0 : Math.round((p4Of(l.poPrice) * l.qtyReceived) / 100)), 0);
    const base = {
      grId: n.grId,
      poId: n.poId,
      number: n.number,
      poRef: n.poRef,
      receivedAt: n.receivedAt.toISOString(),
      receivedValueIls: ils(valueAg),
    };
    const lister = n.number ? listerOf(n.number, n.receivedAt) : undefined;
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
