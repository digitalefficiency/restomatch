import { cn } from './cn';

/** Tiny inline price-trend chart. Rising price = danger (bad), falling = money-green. */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (!data || data.length < 2) return <span className="text-xs text-subtle">—</span>;

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
  // Rising price = leak (danger), falling price = money saved (primary green).
  const stroke = rising ? '#FF5C7A' : '#22D39A';
  const gid = `spark-${rising ? 'up' : 'dn'}`;
  const areaPoints = `0,${h} ${points} ${w},${h}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('h-6 w-20', className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gid})`} stroke="none" />
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
