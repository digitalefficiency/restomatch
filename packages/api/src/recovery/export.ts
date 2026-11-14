import ExcelJS from 'exceljs';
import { sql, type Database, type RecoveryStatus } from '@restomatch/db';
import { listClaims, MAX_CLAIMS } from './service';

/**
 * Recovery export (W2-10, chain-27): every claim of the restaurant (never a
 * silent 200-row cut) plus its full history, as CSV (UTF-8 BOM so Excel reads
 * Hebrew) or XLSX (two sheets). Money columns are ₪ with 2 dp, computed from
 * integer agorot; dates are Asia/Jerusalem `dd.MM.yyyy HH:mm`.
 */

export type RecoveryExportFormat = 'csv' | 'xlsx';

export interface RecoveryExportFilter {
  status?: RecoveryStatus;
  supplierId?: string;
}

const TZ = 'Asia/Jerusalem';
const dt = (iso: string | Date | null): string => {
  if (iso == null) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};
/** Agorot → "1234.50" (a plain number for spreadsheets; display formatting stays in the web). */
const ils = (agorot: number): string => {
  const sign = agorot < 0 ? '-' : '';
  const a = Math.abs(agorot);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

const CLAIM_COLUMNS = [
  'claim_id',
  'supplier',
  'invoice',
  'type',
  'item',
  'status',
  'claimed_ils',
  'credited_ils',
  'outstanding_ils',
  'claimed_at',
  'letter_sent_at',
  'credited_at',
  'recovered_at',
  'closed_at',
  'credit_note',
  'note',
] as const;
const HISTORY_COLUMNS = ['claim_id', 'at', 'from', 'to', 'amount_ils', 'actor', 'role', 'note'] as const;

export async function recoveryExportRows(db: Database, restaurantId: string, filter: RecoveryExportFilter = {}) {
  const claims = await listClaims(db, restaurantId, { status: filter.status, supplierId: filter.supplierId, limit: MAX_CLAIMS });
  const ids = claims.map((c) => c.id);
  const historyRes = ids.length
    ? await db.execute(sql`
        SELECT e.claim_id, e.created_at, e.from_status, e.to_status, e.amount_agorot, e.note, u.name AS actor_name, m.role AS actor_role
        FROM recovery_events e
        LEFT JOIN users u ON u.id = e.actor_id
        LEFT JOIN memberships m ON m.user_id = e.actor_id AND m.restaurant_id = ${restaurantId}
        WHERE e.restaurant_id = ${restaurantId}
          AND e.claim_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY e.claim_id, e.created_at, e.id
      `)
    : [];
  const hist = (Array.isArray(historyRes) ? historyRes : ((historyRes as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
  const claimRows = claims.map((c) => [
    c.id,
    c.supplierName ?? '',
    c.invoiceNumber ?? '',
    c.discrepancyType,
    c.productName ?? c.lineDescription ?? '',
    c.status,
    ils(c.amountAgorot),
    ils(c.creditedAgorot),
    ils(c.outstandingAgorot),
    dt(c.claimedAt),
    dt(c.letterSentAt),
    dt(c.creditedAt),
    dt(c.recoveredAt),
    dt(c.closedAt),
    c.creditNoteNumber ?? '',
    c.note ?? '',
  ]);
  const historyRows = hist.map((h) => [
    String(h.claim_id),
    dt(h.created_at as string | Date),
    (h.from_status as string | null) ?? '',
    String(h.to_status),
    h.amount_agorot == null ? '' : ils(Number(h.amount_agorot)),
    (h.actor_name as string | null) ?? (h.actor_role == null ? 'system' : ''),
    (h.actor_role as string | null) ?? '',
    (h.note as string | null) ?? '',
  ]);
  return { claimRows, historyRows, count: claims.length };
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = (head: readonly string[], rows: string[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

export async function exportRecovery(
  db: Database,
  restaurantId: string,
  input: { format: RecoveryExportFormat } & RecoveryExportFilter,
): Promise<{ filename: string; mime: string; base64: string; count: number }> {
  const { claimRows, historyRows, count } = await recoveryExportRows(db, restaurantId, input);
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  if (input.format === 'csv') {
    // One file: the claims, a blank line, then the history (both with headers).
    const body = `﻿${csv(CLAIM_COLUMNS, claimRows)}\r\n\r\n${csv(HISTORY_COLUMNS, historyRows)}\r\n`;
    return { filename: `recovery-${stamp}.csv`, mime: 'text/csv;charset=utf-8', base64: Buffer.from(body, 'utf8').toString('base64'), count };
  }
  const wb = new ExcelJS.Workbook();
  const add = (name: string, head: readonly string[], rows: string[][], money: number[]) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
    ws.addRow([...head]);
    for (const r of rows) ws.addRow(r.map((v, i) => (money.includes(i) && v !== '' ? Number(v) : v)));
    for (const i of money) ws.getColumn(i + 1).numFmt = '#,##0.00';
  };
  add('claims', CLAIM_COLUMNS, claimRows, [6, 7, 8]);
  add('history', HISTORY_COLUMNS, historyRows, [4]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return {
    filename: `recovery-${stamp}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: buf.toString('base64'),
    count,
  };
}
