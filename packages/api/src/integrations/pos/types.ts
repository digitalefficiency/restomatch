/**
 * POS sales import (wave-1 `integrations`) — the hook food-cost-per-dish
 * (S17) reads. A provider turns whatever the POS gives us (a CSV export
 * today, an API later) into one row per day · POS item.
 */
export interface PosSaleRow {
  /** `YYYY-MM-DD`, the POS business day. */
  soldOn: string;
  /** The POS item code (PLU); the item name when the export has no code. */
  itemRef: string;
  itemName: string;
  /** Quantity in thousandths (integer), so 0.5 kg by weight stays exact. */
  qtyMilli: number;
  /** Net sales (before VAT) in integer agorot. */
  netAgorot: number;
}

export interface PosParseIssue {
  /** 1-based line in the file (header = line 1). */
  line: number;
  code: 'BAD_DATE' | 'BAD_QTY' | 'BAD_AMOUNT' | 'NO_ITEM' | 'BAD_ROW';
  /** The row's business day, when its date was readable. */
  soldOn?: string;
}

export interface PosParseResult {
  rows: PosSaleRow[];
  issues: PosParseIssue[];
  /** Which file columns were used, for the preview. */
  columns: Record<'date' | 'itemRef' | 'itemName' | 'qty' | 'net', string | null>;
  /** Days in the file whose every row was rejected (an import keeps their old data). */
  rejectedDays: string[];
}

export interface PosSalesProvider {
  readonly id: string;
  readonly displayName: string;
  parse(input: { filename: string; bytes: Uint8Array }): PosParseResult;
}

export type PosFileErrorCode = 'EMPTY' | 'NO_COLUMNS' | 'TOO_MANY_ROWS' | 'TOO_LARGE';

/** A file the user has to fix; `code` is forwarded as `POS_FILE_<code>`. */
export class PosFileError extends Error {
  constructor(
    readonly code: PosFileErrorCode,
    readonly missing: string[] = [],
  ) {
    super(`POS_FILE_${code}`);
    this.name = 'PosFileError';
  }
}
