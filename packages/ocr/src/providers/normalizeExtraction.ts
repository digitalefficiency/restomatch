/**
 * Make a model's invoice JSON safe to validate (EN-3).
 *
 * The extraction prompt tells Claude to "leave unreadable fields empty or
 * null". The canonical zod schema, however, models absent fields as
 * `.optional()` — a literal `null` (e.g. `lines[].vatRate`,
 * `supplier.businessId`) failed `.parse()`, the OCR job threw, and the invoice
 * sat in `ocr_pending` forever.
 *
 * 1. Strip `null` recursively (null ⇒ absent). Every field the schema allows
 *    to be null is also optional, so "absent" is always accepted.
 * 2. Repair line items whose REQUIRED numbers are unreadable instead of
 *    rejecting the whole invoice: derive the missing one of
 *    qty / unitPrice / lineTotal from the other two when possible, otherwise
 *    use 0 and force the line's confidence low so the pipeline routes the
 *    invoice to human review. Never invents a ₪ value it can't derive.
 */

const LOW_CONFIDENCE = 0.2;

export function stripNulls(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v)).filter((v) => v !== undefined);
  }
  if (typeof value === 'object' && value !== undefined) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = stripNulls(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/** A finite number, or undefined when the field is absent. Anything else
 *  present (e.g. "twelve") is NOT coerced — the schema must reject it. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

function repairLine(line: unknown): Record<string, unknown> | undefined {
  if (typeof line !== 'object' || line === null) return undefined;
  const l = { ...(line as Record<string, unknown>) };
  if (typeof l.rawDescription !== 'string' || l.rawDescription.trim() === '') return undefined;

  // Only ABSENT numbers are derived; a present non-number is left for the
  // schema to reject (no manufactured ₪ from garbage).
  if ([l.qty, l.unitPrice, l.lineTotal].some((v) => v !== undefined && num(v) === undefined)) return l;

  let qty = num(l.qty);
  let unitPrice = num(l.unitPrice);
  let lineTotal = num(l.lineTotal);
  let repaired = false;

  if (qty === undefined && unitPrice !== undefined && lineTotal !== undefined && unitPrice !== 0) {
    qty = round(lineTotal / unitPrice, 3);
    repaired = true;
  }
  if (unitPrice === undefined && qty !== undefined && lineTotal !== undefined && qty !== 0) {
    unitPrice = round(lineTotal / qty, 4);
    repaired = true;
  }
  if (lineTotal === undefined && qty !== undefined && unitPrice !== undefined) {
    lineTotal = round(qty * unitPrice, 2);
    repaired = true;
  }
  if (qty === undefined || unitPrice === undefined || lineTotal === undefined) {
    qty ??= 0;
    unitPrice ??= 0;
    lineTotal ??= 0;
    repaired = true;
  }

  l.qty = qty;
  l.unitPrice = unitPrice;
  l.lineTotal = lineTotal;
  if (typeof l.unit !== 'string') l.unit = '';
  const c = num(l.confidence);
  if (repaired) l.confidence = Math.min(c ?? LOW_CONFIDENCE, LOW_CONFIDENCE);
  else if (c === undefined) delete l.confidence;
  else l.confidence = Math.max(0, Math.min(1, c));
  const vat = num(l.vatRate);
  if (vat === undefined) delete l.vatRate;
  else l.vatRate = vat;
  return l;
}

export function normalizeExtraction(raw: unknown): unknown {
  const cleaned = stripNulls(raw);
  if (typeof cleaned !== 'object' || cleaned === null || Array.isArray(cleaned)) return cleaned;
  const inv = { ...(cleaned as Record<string, unknown>) };
  if (typeof inv.supplier !== 'object' || inv.supplier === null) inv.supplier = {};
  inv.lines = Array.isArray(inv.lines)
    ? inv.lines.map(repairLine).filter((l): l is Record<string, unknown> => l !== undefined)
    : [];
  const totals = typeof inv.totals === 'object' && inv.totals !== null ? (inv.totals as Record<string, unknown>) : {};
  const fixedTotals: Record<string, number> = {};
  for (const k of ['subtotal', 'vat', 'total'] as const) {
    const n = num(totals[k]);
    if (n !== undefined) fixedTotals[k] = n;
  }
  inv.totals = fixedTotals;
  const conf = num(inv.confidence);
  if (conf === undefined) delete inv.confidence;
  else inv.confidence = Math.max(0, Math.min(1, conf));
  return inv;
}
