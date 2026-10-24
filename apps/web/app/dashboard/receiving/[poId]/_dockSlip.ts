/**
 * Dock dispute slip ("תעודת חריגה") model — pure, so it is unit-tested.
 *
 * Quantities and the kind of issue come from what the receiver recorded in the
 * wizard (ordered / received / rejected / invoiced, PO vs invoice price). The ₪
 * at stake comes ONLY from the matching engine's persisted discrepancies
 * (receiving.dockSlip → claimableLines), never from the wizard's client-side
 * deltas: a line without an engine amount shows quantities only, and the total
 * is exactly the engine total that the claims letters use.
 */
import type { ReconciliationLine } from '@/app/showcase/receiver/_mock';
import { lineKey, type LineMark } from '@/app/showcase/receiver/_state';

export type SlipIssue = 'short' | 'rejected' | 'overPrice' | 'unordered' | 'billedNotReceived';

export interface EngineSlipLine {
  discrepancyId: string;
  type: string;
  poLineId: string | null;
  productId: string | null;
  productName: string | null;
  productNameEn: string | null;
  lineDescription: string | null;
  lineDescriptionEn: string | null;
  expected: number | null;
  actual: number | null;
  amountIls: number;
}

export interface SlipLine {
  key: string;
  name: string;
  nameEn: string | null;
  issues: SlipIssue[];
  /** Engine discrepancy types behind the ₪ (for lines the wizard did not flag). */
  engineTypes: string[];
  ordered: number | null;
  received: number | null;
  rejected: number;
  invoiced: number | null;
  unit: string | null;
  poPrice: number | null;
  invoicePrice: number | null;
  /** Engine ₪ for this line; null = no engine discrepancy → quantities only. */
  amountIls: number | null;
}

const EPS = 0.0005;
const norm = (s: string | null | undefined) => (s ?? '').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** What the receiver's marks say is wrong with one reconciliation line. */
export function lineIssues(line: ReconciliationLine, mark: LineMark | undefined): SlipIssue[] {
  const out: SlipIssue[] = [];
  const received = mark ? mark.qtyReceived : (line.invoiceQty ?? line.poQty ?? 0);
  const rejected = mark?.qtyRejected ?? 0;
  if (line.poLineId === null && line.invoiceLineIndex !== null) out.push('unordered');
  if (line.poQty !== null && received + EPS < line.poQty) out.push('short');
  if (rejected > EPS || mark?.condition === 'rejected' || mark?.condition === 'damaged') out.push('rejected');
  if (line.poUnitPrice !== null && line.invoiceUnitPrice !== null && line.invoiceUnitPrice > line.poUnitPrice + EPS) {
    out.push('overPrice');
  }
  if (line.invoiceQty !== null && line.invoiceQty > received + EPS) out.push('billedNotReceived');
  return out;
}

/** Slip lines: every flagged wizard line + every engine discrepancy, each once. */
export function buildSlipLines(
  lines: ReconciliationLine[],
  marks: Record<string, LineMark>,
  engine: EngineSlipLine[],
): SlipLine[] {
  const remaining = [...engine];
  const take = (pred: (e: EngineSlipLine) => boolean): EngineSlipLine[] => {
    const hit = remaining.filter(pred);
    for (const h of hit) remaining.splice(remaining.indexOf(h), 1);
    return hit;
  };

  const out: SlipLine[] = [];
  for (const line of lines) {
    const mark = marks[lineKey(line)];
    const issues = lineIssues(line, mark);
    const name = norm(line.productName);
    const mine = line.poLineId
      ? take((e) => e.poLineId === line.poLineId)
      : take((e) => (line.productId !== null && e.productId === line.productId) || (!!name && norm(e.lineDescription ?? e.productName) === name));
    if (issues.length === 0 && mine.length === 0) continue;
    out.push({
      key: lineKey(line),
      name: line.productName,
      nameEn: line.productNameEn ?? null,
      issues,
      engineTypes: mine.map((e) => e.type),
      ordered: line.poQty,
      received: mark ? mark.qtyReceived : null,
      rejected: mark?.qtyRejected ?? 0,
      invoiced: line.invoiceQty,
      unit: line.invoiceUnit ?? line.poUnit,
      poPrice: line.poUnitPrice,
      invoicePrice: line.invoiceUnitPrice,
      amountIls: mine.length ? sumIls(mine.map((e) => e.amountIls)) : null,
    });
  }
  // Engine findings the wizard has no row for (e.g. a duplicate invoice, VAT).
  for (const e of remaining) {
    out.push({
      key: `engine-${e.discrepancyId}`,
      name: e.productName ?? e.lineDescription ?? '',
      nameEn: e.productNameEn ?? e.lineDescriptionEn ?? null,
      issues: [],
      engineTypes: [e.type],
      ordered: null,
      received: null,
      rejected: 0,
      invoiced: null,
      unit: null,
      poPrice: null,
      invoicePrice: null,
      amountIls: e.amountIls,
    });
  }
  return out;
}

/** Σ in integer agorot (exact). */
export function sumIls(values: number[]): number {
  return values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;
}

/** Does this receipt need a slip at all? */
export function needsSlip(slipLines: SlipLine[], duplicateNumber: string | null): boolean {
  return Boolean(duplicateNumber) || slipLines.length > 0;
}

/** One line of the shared slip text; invoice-level findings (VAT / total / duplicate) have no item name. */
export function slipBullet(name: string, issues: string[], amount: string | null): string {
  return `• ${name ? `${name}: ` : ''}${issues.join('; ')}${amount !== null ? ` — ${amount}` : ''}`;
}

/**
 * The message key of one issue. Until the engine's post-count run is in, the
 * slip (and its WhatsApp text) carries NO ₪ at all — not even unit prices: an
 * over-price line just says the invoice price is above the order.
 */
export function issueMessageKey(issue: SlipIssue, engineReady: boolean): string {
  return issue === 'overPrice' && !engineReady ? 'overPriceNoAmount' : issue;
}

export type SlipNote = 'afterClose' | 'held' | 'computing' | 'slow' | null;

/** Which status note the slip shows under its lines (null: the ₪ is in, or no invoice). */
export function slipNote(
  engine: { receiptClosed: boolean; ready: boolean; holdReason: string | null },
  hasInvoice: boolean,
  gaveUp: boolean,
): SlipNote {
  if (!hasInvoice || engine.ready) return null;
  if (!engine.receiptClosed) return 'afterClose';
  if (engine.holdReason) return 'held'; // no run will come on its own — say so now, no spinner
  return gaveUp ? 'slow' : 'computing';
}
