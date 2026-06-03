import { cn } from './cn';

/** Tiny inline price-trend chart. Rising price = rose (bad), falling = green. */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (!data || data.length < 2) return <span className="text-xs text-stone-300">—</span>;

  const w = 80;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const rising = data[data.length - 1]! >= data[0]!;
  const stroke = rising ? '#E11D48' : '#15A34A';

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('h-6 w-20', className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
