/**
 * "ממתין להחלטה שלך" — the viewer's whole decision queue in ₪ and count, never
 * one capped page. The server aggregate `approvals.queueSummary` (W1-07) is the
 * source when the router has it: the approvals landing shows the same figures.
 * Until then the queue is paged to the end (de-duplicated by id).
 */

export interface QueueItemLike {
  id: string;
  type: string;
  severity: string;
  deltaAmount: string | number | null;
  createdAt: Date;
}

interface ServerSummary {
  count: number;
  blockers: number;
  claimableIls: number;
}

export interface ApprovalsLike {
  queueSummary?: () => Promise<ServerSummary>;
  myQueue: (input: { limit: number; cursor?: string }) => Promise<QueueItemLike[]>;
}

export interface DecideSummary {
  count: number;
  atRiskIls: number;
  blocking: number;
}

const PAGE = 100;
/** Safety stop: 50 pages × 100 rows; a real queue is a few dozen. */
const MAX_PAGES = 50;

export async function decideSummary(approvals: ApprovalsLike): Promise<DecideSummary> {
  if (approvals.queueSummary) {
    try {
      const s = await approvals.queueSummary();
      return { count: s.count, atRiskIls: s.claimableIls, blocking: s.blockers };
    } catch (err) {
      // Only "this router has no queueSummary yet" falls back; a real failure surfaces.
      // (Matched by code, not instanceof: web and api may load different @trpc copies.)
      if ((err as { code?: unknown } | null)?.code !== 'NOT_FOUND') throw err;
    }
  }

  const seen = new Map<string, QueueItemLike>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await approvals.myQueue({ limit: PAGE, cursor });
    let added = 0;
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.set(r.id, r);
        added += 1;
      }
    }
    if (rows.length < PAGE || added === 0) break;
    // The cursor is strictly older: step 1 ms past the last row so rows sharing its
    // createdAt are re-read (and de-duplicated) instead of skipped.
    const last = rows[rows.length - 1]!;
    cursor = new Date(new Date(last.createdAt).getTime() + 1).toISOString();
  }

  let agorot = 0;
  let blocking = 0;
  for (const d of seen.values()) {
    if (d.type !== 'PRICE_LOWER') agorot += Math.round(Math.abs(Number(d.deltaAmount ?? 0)) * 100);
    if (d.severity === 'block') blocking += 1;
  }
  return { count: seen.size, atRiskIls: agorot / 100, blocking };
}
