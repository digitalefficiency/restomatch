import { parseNumberInput } from '@restomatch/types';

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

/** The server's bounds (`SupplierOrderView.limits`); a value above them is invalid inline, not a 400. */
export interface AnswerLimits {
  maxQty: number;
  maxPrice: number;
}
const NO_LIMITS: AnswerLimits = { maxQty: Number.POSITIVE_INFINITY, maxPrice: Number.POSITIVE_INFINITY };

/**
 * A typed quantity: "12", "7.5", "7,5", "0,250" → number ≥ 0 (3 dp, no thousands
 * grouping — "1,250" is ambiguous for a quantity and is refused), ≤ `max`;
 * anything else null.
 * TODO(G-13): switch to `parseDecimalInput` once it lands.
 * TODO(G-13): the shared parser drops inner spaces, so "12 5" reads as 125 — G-13 refuses it.
 */
export function parseQty(raw: string, max = NO_LIMITS.maxQty): number | null {
  const c = parseNumberInput(raw, { scale: 3, grouping: false });
  return c.kind === 'ok' && c.value >= 0 && c.value <= max ? c.value : null;
}

/** A typed unit price: "9.25", "9,25", "1,250" (thousands) → number > 0 (4 dp), ≤ `max`; anything else null. */
export function parseUnitPrice(raw: string, max = NO_LIMITS.maxPrice): number | null {
  const c = parseNumberInput(raw, { scale: 4 });
  return c.kind === 'ok' && c.value > 0 && c.value <= max ? c.value : null;
}

/** The typed price text says exactly the order's price (including ₪0) → unchanged, never "invalid". */
function isOrderPrice(raw: string, unitPrice: number | null): boolean {
  if (unitPrice == null) return false;
  const c = parseNumberInput(raw, { scale: 4 });
  return c.kind === 'ok' && c.scaled === Math.round(unitPrice * 10_000);
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
  limits: AnswerLimits = NO_LIMITS,
): Answer {
  const rows = lines.map((l): AnswerRow => {
    const qty = parseQty(qtyText[l.id] ?? '', limits.maxQty);
    const typedP = (priceText[l.id] ?? '').trim();
    // The order's own price (a ₪0 line's prefilled "0" included) is "no price
    // change" — checked BEFORE validity, so an untouched form is never invalid.
    const rawP = isOrderPrice(typedP, l.unitPrice) ? '' : typedP;
    const price = rawP === '' ? null : parseUnitPrice(rawP, limits.maxPrice);
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
      // An invalid edit IS an edit: it must block the send, never read as "no change".
      changed: qtyChanged || priceChanged || qtyBad || priceBad,
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
    // Same rows as the order total and the visible line totals: a line the
    // order had no price for stays out of both (and is counted in `unpriced`).
    answerTotalAgorot: priced.reduce((s, r) => s + (r.answerAgorot ?? 0), 0),
    unpriced: rows.length - priced.length,
  };
}

export type AnswerIntent = 'as_ordered' | 'with_changes';

export interface AnswerBody {
  intent: AnswerIntent;
  /** `SupplierOrderView.linesVersion` of the form being answered. */
  linesVersion: string;
  lines: Array<{ poLineId: string; qtyAvailable: number | null; proposedUnitPrice: number | null }>;
  note: string | null;
}

export interface AnswerState {
  lines: PortalLine[];
  linesVersion: string;
  limits?: AnswerLimits;
  qtyText: Record<string, string>;
  priceText: Record<string, string>;
  note: string;
}

export interface BuiltAnswer {
  /** What the ONE primary does. 'invalid' blocks (inline error + focus) — never a fallback to "as ordered". */
  primary: 'invalid' | 'as_ordered' | 'with_changes';
  /** The intent the primary sends. */
  intent: AnswerIntent;
  /** The primary's body: EVERY line, explicit quantities, the note. */
  body: AnswerBody;
  /** The "אישור כפי שהוזמן" text button's body (after the discard confirm): every line as ordered + the note. */
  asOrderedBody: AnswerBody;
  /** What the primary counts: changed lines + 1 for a note. */
  count: number;
  /** Changed lines only — what "as ordered" would discard (the note is always kept). */
  discardCount: number;
  diff: DiffItem[];
  answer: Answer;
}

/**
 * The ONE answer model (G-10): the primary, its label count, the "as ordered"
 * text button and the discard confirm all read it. The server refuses a partial
 * answer, so no body here ever has `lines: []`: "as ordered" sends every line at
 * its ordered quantity with `intent: 'as_ordered'`.
 */
export function buildAnswer(state: AnswerState): BuiltAnswer {
  const answer = computeAnswer(state.lines, state.qtyText, state.priceText, state.note, state.limits);
  const note = state.note.trim() || null;
  const primary: BuiltAnswer['primary'] = answer.invalid ? 'invalid' : answer.changeCount === 0 ? 'as_ordered' : 'with_changes';
  const intent: AnswerIntent = primary === 'as_ordered' ? 'as_ordered' : 'with_changes';
  const asOrderedBody: AnswerBody = {
    intent: 'as_ordered',
    linesVersion: state.linesVersion,
    lines: state.lines.map((l) => ({ poLineId: l.id, qtyAvailable: l.qtyOrdered, proposedUnitPrice: null })),
    note,
  };
  const body: AnswerBody =
    intent === 'as_ordered'
      ? asOrderedBody
      : {
          intent: 'with_changes',
          linesVersion: state.linesVersion,
          lines: answer.rows.map((r) => ({ poLineId: r.line.id, qtyAvailable: r.qty, proposedUnitPrice: r.price })),
          note,
        };
  return { primary, intent, body, asOrderedBody, count: answer.changeCount, discardCount: answer.lineChangeCount, diff: answer.diff, answer };
}

/**
 * The order changed under an open form (409 order_changed → refresh). Keep what
 * the supplier typed wherever the restaurant did not change it, so a typed
 * shortage is never silently reset to "as ordered":
 *  - a line whose ordered qty, order price and unit are unchanged keeps both fields;
 *  - a line whose ordered qty or unit changed gets its qty re-filled, and keeps a typed price;
 *  - a line whose order price changed gets its price re-filled, and keeps a typed qty;
 *  - a new line is prefilled.
 * `changedIds` (new or changed lines) are marked and focused; `refilled` counts
 * the lines where a value the supplier had TYPED was replaced, so the copy can say so.
 */
export function mergeAfterOrderChange(
  prev: ReadonlyArray<PortalLine>,
  next: ReadonlyArray<PortalLine>,
  qtyText: Record<string, string>,
  priceText: Record<string, string>,
): { qtyText: Record<string, string>; priceText: Record<string, string>; changedIds: string[]; removed: number; refilled: number } {
  const before = new Map(prev.map((l) => [l.id, l]));
  const qtyKey = (l: PortalLine) => `${Math.round(l.qtyOrdered * 1000)}:${l.unit}`;
  const priceKey = (l: PortalLine) => (l.unitPrice == null ? '-' : String(Math.round(l.unitPrice * 10_000)));
  const defaultQty = (l: PortalLine) => String(l.qtyOrdered);
  const defaultPrice = (l: PortalLine) => (l.unitPrice == null ? '' : String(l.unitPrice));
  const q: Record<string, string> = {};
  const p: Record<string, string> = {};
  const changedIds: string[] = [];
  let refilled = 0;
  for (const l of next) {
    const old = before.get(l.id);
    if (!old) {
      changedIds.push(l.id);
      q[l.id] = defaultQty(l);
      p[l.id] = defaultPrice(l);
      continue;
    }
    const typedQ = qtyText[l.id] ?? defaultQty(old);
    const typedP = priceText[l.id] ?? defaultPrice(old);
    const qtyChanged = qtyKey(old) !== qtyKey(l);
    const priceChanged = priceKey(old) !== priceKey(l);
    if (qtyChanged || priceChanged) changedIds.push(l.id);
    const lostQ = qtyChanged && typedQ.trim() !== defaultQty(old);
    const lostP = priceChanged && typedP.trim() !== defaultPrice(old);
    if (lostQ || lostP) refilled++;
    q[l.id] = qtyChanged ? defaultQty(l) : typedQ;
    p[l.id] = priceChanged ? defaultPrice(l) : typedP;
  }
  const ids = new Set(next.map((l) => l.id));
  return { qtyText: q, priceText: p, changedIds, removed: prev.filter((l) => !ids.has(l.id)).length, refilled };
}

/** Which "the order was updated" message fits what actually changed (G-10 round 3: never claim a removal that didn't happen). */
export function orderChangedKey(
  changed: number,
  removed: number,
): 'orderChangedNeutral' | 'orderChangedOne' | 'orderChanged' | 'orderChangedRemovedOne' | 'orderChangedRemoved' | 'orderChangedBoth' {
  if (changed === 0 && removed === 0) return 'orderChangedNeutral';
  if (removed === 0) return changed === 1 ? 'orderChangedOne' : 'orderChanged';
  if (changed === 0) return removed === 1 ? 'orderChangedRemovedOne' : 'orderChangedRemoved';
  return 'orderChangedBoth';
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

type RecordedLine = { poLineId: string; qtyAvailable: number | null; proposedUnitPrice: number | null };

/** A sent body → the differences the server would store (it drops unchanged lines). */
function storedForm(lines: PortalLine[], body: AnswerBody): Map<string, string> {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out = new Map<string, string>();
  for (const b of body.lines) {
    const l = byId.get(b.poLineId);
    if (!l) continue;
    const q = b.qtyAvailable != null && Math.round(b.qtyAvailable * 1000) !== Math.round(l.qtyOrdered * 1000) ? Math.round(b.qtyAvailable * 1000) : null;
    const p =
      b.proposedUnitPrice != null && (l.unitPrice == null || Math.round(b.proposedUnitPrice * 10_000) !== Math.round(l.unitPrice * 10_000))
        ? Math.round(b.proposedUnitPrice * 10_000)
        : null;
    if (q !== null || p !== null) out.set(b.poLineId, `${q}|${p}`);
  }
  return out;
}

/**
 * Is the answer already on record the one this browser just tried to send?
 * (A retried submit whose first attempt did land gets a 409 — that is the
 * supplier's own answer, not someone else's.)
 */
export function isOwnAnswer(
  lines: PortalLine[],
  attempted: AnswerBody,
  recorded: { lines: ReadonlyArray<RecordedLine>; note: string | null },
): boolean {
  if ((attempted.note?.trim() || null) !== (recorded.note?.trim() || null)) return false;
  const mine = storedForm(lines, attempted);
  const theirs = new Map(
    recorded.lines.map((r) => [
      r.poLineId,
      `${r.qtyAvailable == null ? null : Math.round(r.qtyAvailable * 1000)}|${r.proposedUnitPrice == null ? null : Math.round(r.proposedUnitPrice * 10_000)}`,
    ]),
  );
  if (mine.size !== theirs.size) return false;
  for (const [id, v] of mine) if (theirs.get(id) !== v) return false;
  return true;
}
