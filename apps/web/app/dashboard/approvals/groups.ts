/**
 * W2-04 — the approvals desk's pure rules (no React): cards grouped by
 * invoice, the group-level primary, and what a bulk selection may do. The
 * SERVER enforces the same caps (`packages/api/src/approvals/bulkPolicy.ts`,
 * `approvals.decideMany`); these rules only keep the UI honest so a refused
 * batch is never offered. A unit test pins the two caps equal.
 */
import { DEFAULT_BULK_CAP_AGOROT } from '@/lib/components/table/selection';

/** ₪200.00 per invoice (owner decision). = server BULK_APPROVE_CAP_AGOROT. */
export const BULK_CAP_AGOROT = DEFAULT_BULK_CAP_AGOROT;

/** The row facts the rules read (a subset of approvals.myQueue's row). */
export interface DeskRow {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  supplierNameEn?: string | null;
  severity: string;
  resolutionStatus: string;
  claimable: boolean;
  claimAgorot: number;
  /** Absent on older payloads: treated as "may act". */
  canAct?: boolean;
}

export interface InvoiceGroup<R extends DeskRow> {
  /** The invoice id, or `row:<id>` for a row with no invoice yet (its own group). */
  key: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  supplierNameEn: string | null;
  rows: R[];
  /** Σ claimable ₪ of the group's rows, agorot (the "₪X בסיכון" figure). */
  claimAgorot: number;
}

/**
 * Group rows by invoice, keeping the server's priority order: a group sits
 * where its first (highest-priority) row sits, and rows keep their order
 * inside it.
 */
export function groupByInvoice<R extends DeskRow>(rows: readonly R[]): InvoiceGroup<R>[] {
  const out: InvoiceGroup<R>[] = [];
  const byKey = new Map<string, InvoiceGroup<R>>();
  for (const r of rows) {
    const key = r.invoiceId ?? `row:${r.id}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        invoiceId: r.invoiceId,
        invoiceNumber: r.invoiceNumber,
        supplierName: r.supplierName,
        supplierNameEn: r.supplierNameEn ?? null,
        rows: [],
        claimAgorot: 0,
      };
      byKey.set(key, g);
      out.push(g);
    }
    g.rows.push(r);
    g.claimAgorot += r.claimable ? Math.max(0, r.claimAgorot) : 0;
  }
  return out;
}

export type GroupPrimaryBlock = 'single' | 'block' | 'cannotAct' | 'overCap' | 'noClaim';

/**
 * May the group show ONE primary ("אשרו את כל החשבונית")? Only when it has
 * more than one row, every row is non-block, the viewer may act on all of
 * them, it has ₪ to claim, and its claimable ₪ ≤ the per-invoice cap.
 */
export function groupPrimary<R extends DeskRow>(
  g: InvoiceGroup<R>,
  cap: number = BULK_CAP_AGOROT,
): { ok: true } | { ok: false; why: GroupPrimaryBlock } {
  if (g.rows.length < 2) return { ok: false, why: 'single' };
  if (g.rows.some((r) => r.severity === 'block')) return { ok: false, why: 'block' };
  if (g.rows.some((r) => r.canAct === false)) return { ok: false, why: 'cannotAct' };
  if (g.claimAgorot <= 0) return { ok: false, why: 'noClaim' };
  if (g.claimAgorot > cap) return { ok: false, why: 'overCap' };
  return { ok: true };
}

/** Why a row may not join a bulk approve (null = it may). */
export function rowBulkBlock(r: DeskRow): 'block' | 'cannotAct' | null {
  if (r.severity === 'block') return 'block';
  if (r.canAct === false) return 'cannotAct';
  return null;
}

/**
 * The bulk-approve state of a selection: the Σ, and why it is refused —
 * any blocking / not-mine row, or any invoice whose selected claimable ₪ is
 * over the cap. Mirrors `bulkRefusals` on the server.
 */
export function bulkSelection<R extends DeskRow>(
  rows: readonly R[],
  selected: ReadonlySet<string>,
  cap: number = BULK_CAP_AGOROT,
): {
  rows: R[];
  sumAgorot: number;
  blocked: Array<{ id: string; why: 'block' | 'cannotAct' | 'over_cap' }>;
  disabled: boolean;
} {
  const picked = rows.filter((r) => selected.has(r.id));
  const perInvoice = new Map<string, number>();
  for (const r of picked) {
    const k = r.invoiceId ?? `row:${r.id}`;
    perInvoice.set(k, (perInvoice.get(k) ?? 0) + (r.claimable ? Math.max(0, r.claimAgorot) : 0));
  }
  const blocked: Array<{ id: string; why: 'block' | 'cannotAct' | 'over_cap' }> = [];
  for (const r of picked) {
    const own = rowBulkBlock(r);
    if (own) blocked.push({ id: r.id, why: own });
    else if ((perInvoice.get(r.invoiceId ?? `row:${r.id}`) ?? 0) > cap) blocked.push({ id: r.id, why: 'over_cap' });
  }
  const sumAgorot = [...perInvoice.values()].reduce((n, v) => n + v, 0);
  return { rows: picked, sumAgorot, blocked, disabled: picked.length === 0 || blocked.length > 0 };
}

/** A fresh id for one batch call (server replay key). */
export function newClientMutationId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `cm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
