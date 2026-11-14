import { cnMerge as cn } from '../cn';

const W = 240;
const H = 64;

/** A cumulative step path over `days` columns, scaled to `top` (the larger series' end). */
export function stepPath(values: readonly number[], days: number, top: number): string {
  const x = (i: number) => (days <= 0 ? 0 : (i / days) * W);
  const y = (v: number) => (top <= 0 ? H : H - (Math.max(0, v) / top) * (H - 2));
  let d = `M0,${H}`;
  values.forEach((v, i) => {
    d += ` V${y(v).toFixed(1)} H${x(i + 1).toFixed(1)}`;
  });
  return d;
}

/**
 * The pace line (DS3 kit "גרפים"; SPEC §10.1): this period's cumulative amount as a solid ink step
 * line against the same days of the previous period as a thin dashed one, over a baseline. It is
 * cumulative so that one unusual day does not turn the picture. Time runs left to right in every
 * language (never mirrored). The picture is one image for assistive tech: `label` says what it shows.
 */
export function PaceLine({
  current,
  previous,
  days,
  label,
  legend,
  className,
}: {
  /** Cumulative values, one per day so far. */
  current: readonly number[];
  /** Cumulative values of the previous period, one per day (the whole period). */
  previous?: readonly number[];
  /** Days in the period (columns); defaults to the longer series. */
  days?: number;
  /** One sentence: "הדליפה המצטברת באוקטובר מעט מתחת לספטמבר". */
  label: string;
  /** Optional legend: [this period, previous period]. */
  legend?: [string, string];
  className?: string;
}) {
  const n = days ?? Math.max(current.length, previous?.length ?? 0);
  const top = Math.max(current.at(-1) ?? 0, previous?.at(-1) ?? 0, ...current, ...(previous ?? []));
  const endX = n > 0 ? (current.length / n) * W : 0;
  const endY = top > 0 ? H - (Math.max(0, current.at(-1) ?? 0) / top) * (H - 2) : H;
  return (
    <figure className={cn('m-0', className)} data-pace-line="">
      <svg viewBox={`-4 -6 ${W + 10} ${H + 12}`} role="img" aria-label={label} className="block h-auto w-full overflow-visible [direction:ltr]">
        <line x1="0" y1={H} x2={W} y2={H} className="stroke-line" strokeWidth="1" />
        {previous?.length ? (
          <path d={stepPath(previous, n, top)} fill="none" className="stroke-line-strong" strokeWidth="1.5" strokeDasharray="2 3" strokeLinecap="round" />
        ) : null}
        {current.length ? (
          <>
            <path d={stepPath(current, n, top)} fill="none" className="stroke-fg" strokeWidth="2" strokeLinejoin="round" />
            <circle cx={endX} cy={endY} r="4" className="fill-fg stroke-surface" strokeWidth="2" />
          </>
        ) : null}
      </svg>
      {legend ? (
        <figcaption aria-hidden="true" className="mt-1 flex flex-wrap gap-x-3.5 text-caption text-fg-secondary">
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-3.5 border-t-2 border-fg" />
            {legend[0]}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-3.5 border-t-2 border-dashed border-line-strong" />
            {legend[1]}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
