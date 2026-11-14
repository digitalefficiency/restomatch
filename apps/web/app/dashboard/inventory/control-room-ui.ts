/**
 * W3-02b · pure helpers for the food-cost control room card: where each
 * equation term drills to, and the sparkline geometry (a missing period is a
 * gap in the line, never a 0% point).
 */
export type Drill =
  | { kind: 'count'; countId: string }
  | { kind: 'invoices'; from: string; to: string }
  | { kind: 'credits'; from: string; to: string }
  | { kind: 'sales'; countId: string; source: 'pos' | 'manual' | null };

/** Year·month index of a local YYYY-MM-DD, and of "now" in Israel time. */
const ymOf = (ymd: string) => Number(ymd.slice(0, 4)) * 12 + (Number(ymd.slice(5, 7)) - 1);
function ilYm(now: Date): number {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
  return y! * 12 + (m! - 1);
}

/**
 * The link behind a term:
 *  - a count (opening / closing stock, or the manual sales on the closing count) → that count;
 *  - purchases → the invoice register on the period's closing month (`?month=` is an offset ≤ 0, floored at −24 as the register does);
 *  - credits → the recovery screen (credit requests).
 */
export function drillHref(d: Drill, now: Date = new Date()): string {
  switch (d.kind) {
    case 'count':
      return `/dashboard/inventory/${d.countId}`;
    case 'sales':
      return `/dashboard/inventory/${d.countId}`;
    case 'invoices': {
      const offset = Math.max(-24, Math.min(0, ymOf(d.to) - ilYm(now)));
      return `/dashboard/invoices?month=${offset}`;
    }
    case 'credits':
      return '/dashboard/recovery';
  }
}

export interface SparkPoint {
  closingDate: string;
  bp: number | null;
}

/**
 * SVG geometry in a w×h box: one polyline segment per run of consecutive known
 * points (a null breaks the line), the dots, and the target line's y.
 */
export function sparkGeometry(points: readonly SparkPoint[], targetBp: number, minBp: number, maxBp: number, w = 240, h = 56, pad = 6) {
  const lo = Math.min(minBp, targetBp);
  const hi = Math.max(maxBp, targetBp);
  const range = hi - lo || 1;
  const x = (i: number) => (points.length <= 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (points.length - 1));
  const y = (bp: number) => pad + (1 - (bp - lo) / range) * (h - 2 * pad);
  const segments: string[] = [];
  let run: string[] = [];
  const dots: Array<{ cx: number; cy: number; bp: number; closingDate: string }> = [];
  points.forEach((p, i) => {
    if (p.bp == null) {
      if (run.length > 1) segments.push(run.join(' '));
      run = [];
      return;
    }
    const cx = x(i);
    const cy = y(p.bp);
    run.push(`${cx.toFixed(1)},${cy.toFixed(1)}`);
    dots.push({ cx, cy, bp: p.bp, closingDate: p.closingDate });
  });
  if (run.length > 1) segments.push(run.join(' '));
  return { segments, dots, targetY: y(targetBp), w, h };
}
