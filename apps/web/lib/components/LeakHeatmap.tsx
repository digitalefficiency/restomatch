export interface LeakCell {
  productName: string;
  supplierName: string;
  deltaPct: number;
  monthExcessIls: number;
  category?: string | null;
}

/** Interpolate warm-paper → rose by leak intensity (~5%..50%+ over baseline). */
function leakColor(deltaPct: number): { bg: string; text: string } {
  const intensity = Math.max(0.16, Math.min(1, (deltaPct - 0.05) / 0.45));
  // warm paper #FBFAF7 (251,250,247) → rose #E11D48 (225,29,72)
  const r = Math.round(251 + (225 - 251) * intensity);
  const g = Math.round(250 + (29 - 250) * intensity);
  const b = Math.round(247 + (72 - 247) * intensity);
  return { bg: `rgb(${r}, ${g}, ${b})`, text: intensity > 0.5 ? '#ffffff' : '#15201a' };
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
 * supplier) pair, colored by how far the last price exceeds its baseline,
 * sorted by monthly money lost. Server-safe (no hooks).
 */
export function LeakHeatmap({ items, max = 24 }: { items: LeakCell[]; max?: number }) {
  const sorted = [...items].sort((a, b) => b.monthExcessIls - a.monthExcessIls);
  const shown = sorted.slice(0, max);
  const hidden = sorted.length - shown.length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((c, i) => {
          const { bg, text } = leakColor(c.deltaPct);
          return (
            <div
              key={`${c.productName}-${c.supplierName}-${i}`}
              className="relative overflow-hidden rounded-xl p-3 ring-1 ring-black/5 transition-transform hover:scale-[1.03]"
              style={{ background: bg, color: text }}
              title={`${c.productName} · ${c.supplierName}: +${(c.deltaPct * 100).toFixed(1)}% · ${fmtIls(c.monthExcessIls)}`}
            >
              <div className="text-lg font-bold tabular-nums">+{(c.deltaPct * 100).toFixed(0)}%</div>
              <div className="mt-1 truncate text-sm font-medium">{c.productName}</div>
              <div className="truncate text-xs opacity-80">{c.supplierName}</div>
              <div className="mt-2 text-xs font-semibold tabular-nums opacity-90">
                {fmtIls(c.monthExcessIls)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-stone-500">
        <div className="flex items-center gap-2">
          <span>קל</span>
          <span
            className="h-3 w-24 rounded-full ring-1 ring-black/5"
            style={{ background: 'linear-gradient(90deg, #FBFAF7, #E11D48)' }}
            aria-hidden="true"
          />
          <span>חריג</span>
        </div>
        {hidden > 0 ? <span>ועוד {hidden} פריטים בטבלה למטה</span> : null}
      </div>
    </div>
  );
}
