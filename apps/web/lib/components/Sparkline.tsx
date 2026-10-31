import { cn } from './cn';

/**
 * Tiny inline trend chart. Without `tone` it is the v1 price-trend look:
 * rising = danger (a price leak), falling = money-green, with a soft area.
 * v2 (`tone="muted" | "leak"`): a 1.5 px stroke and a 4 px last-point dot, no
 * area. With `label` it is `role="img"` with that sentence (C14); without, it
 * is decorative and the adjacent text must carry the numbers.
 */
export function Sparkline({
  data,
  className,
  label,
  tone,
}: {
  data: number[];
  className?: string;
  /** A sentence: "מגמת דליפה: יורדת, מ-131 ₪ ל-0 ₪". */
  label?: string;
  tone?: 'muted' | 'leak';
}) {
  if (!data || data.length < 2) return <span className="text-xs text-subtle">—</span>;

  const w = 80;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const coords = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / range) * (tone ? h - 4 : h) - (tone ? 2 : 0)] as const);
  const points = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const rising = data[data.length - 1]! >= data[0]!;
  const stroke = tone === 'muted' ? 'rgb(var(--c-ink) / 0.7)' : tone === 'leak' || rising ? 'rgb(var(--c-danger))' : 'rgb(var(--c-primary))';
  const gid = `spark-${rising ? 'up' : 'dn'}`;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  const last = coords[coords.length - 1]!;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn('h-6 w-20 overflow-visible', className)} preserveAspectRatio="none" {...a11y}>
      {tone ? null : (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: stroke, stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: stroke, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <polygon points={`0,${h} ${points} ${w},${h}`} fill={`url(#${gid})`} stroke="none" />
        </>
      )}
      <polyline points={points} fill="none" style={{ stroke }} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect={tone ? 'non-scaling-stroke' : undefined} />
      {tone ? <circle cx={last[0]} cy={last[1]} r="2" style={{ fill: stroke }} /> : null}
    </svg>
  );
}
