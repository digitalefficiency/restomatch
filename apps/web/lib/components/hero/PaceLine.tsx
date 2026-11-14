import { cn } from '../cn';
import { PACE_BOX, paceGeometry, type PaceSeries } from './model';

export interface PaceLineProps {
  series: PaceSeries;
  /** Legend of the solid line: this month's name ("נובמבר"). */
  curLabel: string;
  /** Legend of the dashed line ("אוקטובר, אותם ימים"); omit when last month has no comparable days. */
  prevLabel?: string | null;
  /** The figure's accessible name: what the two lines are. */
  label: string;
  className?: string;
}

/**
 * The pace line beside the leak (DS3 SPEC §10.1): this month's running leak against the same days of
 * last month, as two step lines on one scale (the reference's box, `PACE_BOX`). It carries no figure of
 * its own: the number beside it and the change sentence under it say the amounts, so the chart is
 * hidden from assistive tech and the figure is named by `label`. Time runs left to right in every
 * language (charts never mirror). Colours are roles; the entry motion (`data-entry-part`) is run, once,
 * by the hero's amount island, and never under reduced motion.
 */
export function PaceLine({ series, curLabel, prevLabel, label, className }: PaceLineProps) {
  const g = paceGeometry(series);
  return (
    <figure aria-label={label} data-testid="leak-hero-pace" className={cn('m-0 min-w-0', className)}>
      <svg viewBox={PACE_BOX.viewBox} className="block h-auto w-full overflow-visible" aria-hidden="true" focusable="false">
        <line x1={0} y1={PACE_BOX.baseline} x2={PACE_BOX.width} y2={PACE_BOX.baseline} className="stroke-line" strokeWidth={1} />
        {g.prev ? (
          <path
            d={g.prev}
            fill="none"
            className="stroke-line-strong"
            strokeWidth={1.5}
            strokeDasharray="2 3"
            strokeLinecap="round"
            data-entry-part="fade"
          />
        ) : null}
        <path
          d={g.cur}
          fill="none"
          className="stroke-ink"
          strokeWidth={2}
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          data-entry-part="draw"
        />
        <circle
          cx={g.end.x}
          cy={g.end.y}
          r={4}
          className="fill-ink stroke-surface"
          strokeWidth={2}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          data-entry-part="pop"
        />
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3.5 text-caption text-muted">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <i className="inline-block w-3.5 border-t-2 border-ink" aria-hidden="true" />
          {curLabel}
        </span>
        {g.prev && prevLabel ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <i className="inline-block w-3.5 border-t border-dashed border-line-strong" aria-hidden="true" />
            {prevLabel}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
