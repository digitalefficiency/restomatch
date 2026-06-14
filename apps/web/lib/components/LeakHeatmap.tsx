import { cn } from './cn';

export interface LeakCell {
  productName: string;
  supplierName: string;
  deltaPct: number;
  monthExcessIls: number;
  category?: string | null;
}

/**
 * Interpolate dark surface → neon danger by leak intensity (~5%..50%+ over
 * baseline). Returns a background, a text color tuned for contrast, the raw
 * intensity, and a glow strength for hot cells.
 */
function leakColor(deltaPct: number): { bg: string; text: string; intensity: number } {
  const intensity = Math.max(0.12, Math.min(1, (deltaPct - 0.05) / 0.45));
  // surface-2 #1C2A23 (28,42,35) → danger #FF5C7A (255,92,122)
  const r = Math.round(28 + (255 - 28) * intensity);
  const g = Math.round(42 + (92 - 42) * intensity);
  const b = Math.round(35 + (122 - 35) * intensity);
  // Keep ink readable on dim cells; switch to dark ink on the hottest fills.
  const text = intensity > 0.62 ? '#07120D' : '#ECF5EF';
  return { bg: `rgb(${r}, ${g}, ${b})`, text, intensity };
}

function fmtIls(v: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(v);
}

/**
 * Leak heatmap — the signature data-viz. Each tile is a leaking (product,
 * supplier) pair, colored by how far the last price exceeds its baseline, with
 * a danger glow that intensifies with the leak, sorted by monthly money lost.
 * Server-safe (no hooks).
 */
export function LeakHeatmap({ items, max = 24 }: { items: LeakCell[]; max?: number }) {
  const sorted = [...items].sort((a, b) => b.monthExcessIls - a.monthExcessIls);
  const shown = sorted.slice(0, max);
  const hidden = sorted.length - shown.length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((c, i) => {
          const { bg, text, intensity } = leakColor(c.deltaPct);
          const hot = intensity > 0.55;
          return (
            <div
              key={`${c.productName}-${c.supplierName}-${i}`}
              className={cn(
                'relative overflow-hidden rounded-xl p-3 ring-1 ring-line transition-transform hover:scale-[1.03]',
                hot && 'shadow-glow-danger',
              )}
              style={{
                background: bg,
                color: text,
                boxShadow: hot
                  ? `0 0 0 1px rgba(255,92,122,${0.25 + intensity * 0.35}), 0 8px 26px -8px rgba(255,92,122,${0.3 + intensity * 0.4})`
                  : undefined,
              }}
              title={`${c.productName} · ${c.supplierName}: +${(c.deltaPct * 100).toFixed(1)}% · ${fmtIls(c.monthExcessIls)}`}
            >
              <div className="font-mono text-lg font-extrabold tabular-nums">
                +{(c.deltaPct * 100).toFixed(0)}%
              </div>
              <div className="mt-1 truncate text-sm font-semibold">{c.productName}</div>
              <div className="truncate text-xs opacity-80">{c.supplierName}</div>
              <div className="mt-2 font-mono text-xs font-semibold tabular-nums opacity-90">
                {fmtIls(c.monthExcessIls)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-2">
          <span>קל</span>
          <span
            className="h-3 w-24 rounded-full ring-1 ring-line"
            style={{ background: 'linear-gradient(90deg, #1C2A23, #FF5C7A)' }}
            aria-hidden="true"
          />
          <span>חריג</span>
        </div>
        {hidden > 0 ? <span>ועוד {hidden} פריטים בטבלה למטה</span> : null}
      </div>
    </div>
  );
}
