import { cnMerge as cn } from '../cn';

/** The reference's drawing box (SPEC §10.1, kit "גרפים"): 240 × 64 over a baseline, 2 units of headroom. */
export const PACE_BOX = { viewBox: '-2 -6 250 78', width: 240, baseline: 64, top: 2 } as const;

/**
 * The two series of a pace line, as running totals for days 1..n: this period so far, and the SAME
 * days of the previous period (`null` when it has no comparable days). Both span the full width.
 * The caller shapes them from the existing procedures; nothing is computed here but the drawing.
 */
export interface PaceSeries {
  cur: readonly number[];
  prev: readonly number[] | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A step-after path of a running total ("M0,64 V… H… V…"): each total holds until the next day it
 * changes, then rises. Time runs left to right in every language (charts never mirror).
 */
export function pacePath(totals: readonly number[], max: number): string {
  const n = totals.length;
  const x = (i: number) => (n <= 1 ? 0 : (i * PACE_BOX.width) / (n - 1));
  const y = (v: number) => PACE_BOX.baseline - (max > 0 ? (Math.max(0, v) / max) * (PACE_BOX.baseline - PACE_BOX.top) : 0);
  let d = `M0,${PACE_BOX.baseline}`;
  totals.forEach((v, i) => {
    if (i > 0) d += ` H${round1(x(i))}`;
    d += ` V${round1(y(v))}`;
  });
  return d;
}

/** Both paths on one scale (the larger of the two), and the end of this period's line. */
export function paceGeometry(s: PaceSeries): { cur: string; prev: string | null; end: { x: number; y: number } } {
  const max = Math.max(1, ...s.cur, ...(s.prev ?? []));
  const last = s.cur[s.cur.length - 1] ?? 0;
  return {
    cur: pacePath(s.cur, max),
    prev: s.prev?.length ? pacePath(s.prev, max) : null,
    end: {
      x: s.cur.length <= 1 ? 0 : PACE_BOX.width,
      y: round1(PACE_BOX.baseline - (Math.max(0, last) / max) * (PACE_BOX.baseline - PACE_BOX.top)),
    },
  };
}

/**
 * The pace line (DS3 kit "גרפים"; SPEC §10.1): this period's running amount as a solid ink step line
 * against the same days of the previous period as a thin dashed one, over a baseline. It is
 * cumulative, so one unusual day does not turn the picture. It carries no figure of its own: the
 * number beside it and the sentence under it say the amounts, so the drawing is hidden from
 * assistive tech and the figure is named by `label`; the legend stays readable.
 *
 * The parts carry `data-entry-part` (`fade` · `draw` · `pop`) so a screen that plays the entry motion
 * once (the owner home) can run it without drawing its own line; the line is complete without it.
 */
export function PaceLine({
  series,
  curLabel,
  prevLabel,
  label,
  testId,
  className,
}: {
  series: PaceSeries;
  /** Legend of the solid line: this period's name ("אוקטובר"). */
  curLabel: string;
  /** Legend of the dashed line ("ספטמבר, אותם ימים"); omit when the previous period has no comparable days. */
  prevLabel?: string | null;
  /** The figure's accessible name: what the two lines are, and how they compare. */
  label: string;
  /** A test hook for the screen that shows it. */
  testId?: string;
  className?: string;
}) {
  const g = paceGeometry(series);
  return (
    <figure aria-label={label} data-pace-line="" data-testid={testId} className={cn('m-0 min-w-0', className)}>
      <svg viewBox={PACE_BOX.viewBox} className="block h-auto w-full overflow-visible" aria-hidden="true" focusable="false">
        <line x1={0} y1={PACE_BOX.baseline} x2={PACE_BOX.width} y2={PACE_BOX.baseline} className="stroke-line" strokeWidth={1} />
        {g.prev ? (
          <path d={g.prev} fill="none" className="stroke-line-strong" strokeWidth={1.5} strokeDasharray="2 3" strokeLinecap="round" data-entry-part="fade" />
        ) : null}
        <path d={g.cur} fill="none" className="stroke-fg" strokeWidth={2} strokeLinejoin="round" pathLength={1} strokeDasharray={1} data-entry-part="draw" />
        <circle
          cx={g.end.x}
          cy={g.end.y}
          r={4}
          className="fill-fg stroke-surface"
          strokeWidth={2}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          data-entry-part="pop"
        />
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3.5 text-caption text-fg-secondary">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <i className="inline-block w-3.5 border-t-2 border-fg" aria-hidden="true" />
          {curLabel}
        </span>
        {g.prev && prevLabel ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <i className="inline-block w-3.5 border-t-[1.5px] border-dashed border-line-strong" aria-hidden="true" />
            {prevLabel}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
