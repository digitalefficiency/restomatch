import { cn } from './cn';
import { formatIls } from '../money';
import type { Locale } from '../i18n/config';
import { formatPercent } from '../i18n/format';

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


/**
 * Leak heatmap — the signature data-viz. Each tile is a leaking (product,
 * supplier) pair, colored by how far the last price exceeds its baseline, with
 * a danger glow that intensifies with the leak, sorted by monthly money lost.
 * Server-safe (no hooks).
 */
export function LeakHeatmap({
  items,
  max = 24,
  locale = 'he',
  labels,
}: {
  items: LeakCell[];
  max?: number;
  locale?: Locale;
  /** Translated legend strings; `more` may contain `{count}`. Hebrew by default. */
  labels?: { mild: string; severe: string; more: string };
}) {
  const fmtIls = (v: number) => formatIls(v, { locale });
  // One formatter + precision for tiles, tooltip and the detective table (1 decimal).
  const pct = (v: number) => formatPercent(v, locale, 1);
  const l = labels ?? { mild: 'קל', severe: 'חריג', more: 'ועוד {count} פריטים בטבלה למטה' };
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
              title={`${c.productName} · ${c.supplierName}: +${pct(c.deltaPct)} · ${fmtIls(c.monthExcessIls)}`}
            >
              <div className="font-mono text-lg font-extrabold tabular-nums" dir="ltr">
                +{pct(c.deltaPct)}
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
          <span>{l.mild}</span>
          <span
            className="h-3 w-24 rounded-full ring-1 ring-line rtl:-scale-x-100"
            style={{ background: 'linear-gradient(90deg, #1C2A23, #FF5C7A)' }}
            aria-hidden="true"
          />
          <span>{l.severe}</span>
        </div>
        {hidden > 0 ? <span>{l.more.replace('{count}', String(hidden))}</span> : null}
      </div>
    </div>
  );
}
