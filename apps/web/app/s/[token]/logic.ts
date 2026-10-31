import { parsePrice } from '@/app/dashboard/contracts/logic';

/**
 * The supplier's answer, as pure functions (auth-02, auth-16): what changed,
 * what the primary button sends, and the ₪ totals the portal shows. Pure so the
 * rule "a marked change is never dropped" is unit-tested, not just clicked.
 */
export interface PortalLine {
  id: string;
  name: string;
  sku: string | null;
  qtyOrdered: number;
  unit: string;
  unitPrice: number | null;
  /** The order price IS the contract price → "agreed"; otherwise "order price". */
  agreed: boolean;
}

/** "12", "7.5", "7,5", "0" → number ≥ 0; anything else null. */
export function parseQty(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(s)) return null;
  return Number(s);
}

/**
 * qty × unit price → integer agorot, rounded half-up once at the line (the
 * AGENTS.md rule): qty to 3 dp × price to 4 dp in exact integers (BigInt —
 * 1e9 × 1e11 overflows a double), then one rounding step.
 */
export function lineAgorot(qty: number, unitPrice: number): number {
  const milli = BigInt(Math.round(qty * 1000)); // 1/1000 unit
  const priceUnits = BigInt(Math.round(unitPrice * 10_000)); // 1/100 agora
  const scaled = milli * priceUnits; // 1e-7 ₪ = 1e-5 agora
  return Number((scaled + 50_000n) / 100_000n);
}

export type DiffItem =
  | { kind: 'out'; lineId: string; name: string }
  | { kind: 'short'; lineId: string; name: string; qty: number; ordered: number; unit: string }
  | { kind: 'more'; lineId: string; name: string; qty: number; ordered: number; unit: string }
  | { kind: 'price'; lineId: string; name: string; price: number; unit: string };

export interface AnswerRow {
  line: PortalLine;
  qty: number | null;
  price: number | null;
  qtyBad: boolean;
  priceBad: boolean;
  out: boolean;
  shortage: boolean;
  priceChanged: boolean;
  changed: boolean;
  /** The line as ordered (null = no price on the order). */
  orderAgorot: number | null;
  /** The line as answered (null = unknown: no price, or an invalid field). */
  answerAgorot: number | null;
}

export interface Answer {
  rows: AnswerRow[];
  diff: DiffItem[];
  /** Changed lines + 1 for a note — what the primary button counts. */
  changeCount: number;
  /** Changed lines only — what "confirm as ordered" would discard (the note is always kept). */
  lineChangeCount: number;
  invalid: boolean;
  orderTotalAgorot: number;
  answerTotalAgorot: number;
  /** Lines with no price: excluded from both totals and said so ("not incl. N lines"). */
  unpriced: number;
}

export function computeAnswer(
  lines: PortalLine[],
  qtyText: Record<string, string>,
  priceText: Record<string, string>,
  note: string,
): Answer {
  const rows = lines.map((l): AnswerRow => {
    const qty = parseQty(qtyText[l.id] ?? '');
    const rawP = (priceText[l.id] ?? '').trim();
    const price = rawP === '' ? null : parsePrice(rawP);
    const qtyBad = qty === null;
    const priceBad = rawP !== '' && price === null;
    const qtyChanged = qty !== null && Math.round(qty * 1000) !== Math.round(l.qtyOrdered * 1000);
    const priceChanged =
      price !== null && (l.unitPrice == null || Math.round(price * 10_000) !== Math.round(l.unitPrice * 10_000));
    const effPrice = price ?? l.unitPrice;
    return {
      line: l,
      qty,
      price,
      qtyBad,
      priceBad,
      out: qty === 0 && l.qtyOrdered > 0,
      shortage: qty !== null && qty < l.qtyOrdered,
      priceChanged,
      changed: qtyChanged || priceChanged,
      orderAgorot: l.unitPrice == null ? null : lineAgorot(l.qtyOrdered, l.unitPrice),
      answerAgorot: qty === null || priceBad || effPrice == null ? null : lineAgorot(qty, effPrice),
    };
  });
  const diff: DiffItem[] = [];
  for (const r of rows) {
    const base = { lineId: r.line.id, name: r.line.name };
    if (r.qty !== null && r.qty !== r.line.qtyOrdered && Math.round(r.qty * 1000) !== Math.round(r.line.qtyOrdered * 1000)) {
      if (r.out) diff.push({ kind: 'out', ...base });
      else diff.push({ kind: r.qty < r.line.qtyOrdered ? 'short' : 'more', ...base, qty: r.qty, ordered: r.line.qtyOrdered, unit: r.line.unit });
    }
    if (r.priceChanged && r.price !== null) diff.push({ kind: 'price', ...base, price: r.price, unit: r.line.unit });
  }
  const priced = rows.filter((r) => r.orderAgorot !== null);
  return {
    rows,
    diff,
    changeCount: rows.filter((r) => r.changed).length + (note.trim() ? 1 : 0),
    lineChangeCount: rows.filter((r) => r.changed).length,
    invalid: rows.some((r) => r.qtyBad || r.priceBad),
    orderTotalAgorot: priced.reduce((s, r) => s + (r.orderAgorot ?? 0), 0),
    answerTotalAgorot: rows.reduce((s, r) => s + (r.answerAgorot ?? 0), 0),
    unpriced: rows.length - priced.length,
  };
}

export interface AnswerBody {
  lines: Array<{ poLineId: string; qtyAvailable: number | null; proposedUnitPrice: number | null }>;
  note: string | null;
}

/**
 * The request body. `answer` carries EVERY line with an explicit quantity (the
 * server refuses a partial list) + the note. `asIs` sends no lines — the UI
 * only offers it with line edits on screen after the supplier explicitly agrees
 * to discard them — but the supplier's note is always carried.
 */
export function answerBody(kind: 'answer' | 'asIs', a: Answer, note: string): AnswerBody {
  if (kind === 'asIs') return { lines: [], note: note.trim() || null };
  return {
    lines: a.rows.map((r) => ({ poLineId: r.line.id, qtyAvailable: r.qty, proposedUnitPrice: r.price })),
    note: note.trim() || null,
  };
}

/** A recorded answer (supplier_responses.lines) → the same diff items, for "already answered". */
export function recordedDiff(
  lines: PortalLine[],
  recorded: ReadonlyArray<{ poLineId: string; qtyAvailable: number | null; proposedUnitPrice: number | null }>,
): DiffItem[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: DiffItem[] = [];
  for (const r of recorded) {
    const l = byId.get(r.poLineId);
    if (!l) continue;
    const base = { lineId: l.id, name: l.name };
    if (r.qtyAvailable !== null) {
      if (r.qtyAvailable === 0) out.push({ kind: 'out', ...base });
      else out.push({ kind: r.qtyAvailable < l.qtyOrdered ? 'short' : 'more', ...base, qty: r.qtyAvailable, ordered: l.qtyOrdered, unit: l.unit });
    }
    if (r.proposedUnitPrice !== null) out.push({ kind: 'price', ...base, price: r.proposedUnitPrice, unit: l.unit });
  }
  return out;
}

/** An Israeli phone on file → `tel:` digits and the wa.me number; null when unusable. */
export function contactNumbers(raw: string | null | undefined): { tel: string; wa: string } | null {
  if (!raw) return null;
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  let intl: string;
  if (plus || digits.startsWith('972')) intl = digits;
  else if (digits.startsWith('0')) intl = `972${digits.slice(1)}`;
  else return null;
  if (intl.length < 11 || intl.length > 13) return null;
  return { tel: `+${intl}`, wa: intl };
}
