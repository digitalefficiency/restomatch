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
 * Interpolate a pale danger tint → deep danger by leak intensity (~5%..50%+ over
 * baseline). Returns a background, a text color that stays WCAG AA (≥4.5:1) on
 * it, and the raw intensity. The ramp skips the band where neither ink nor
 * white text would reach 4.5:1: ink up to t=0.55, white from t=0.68.
 */
function leakColor(deltaPct: number): { bg: string; text: string; intensity: number } {
  const intensity = Math.max(0.12, Math.min(1, (deltaPct - 0.05) / 0.45));
  const t = intensity <= 0.55 ? intensity : 0.68 + ((intensity - 0.55) / 0.45) * 0.32;
  // #FDECEE (253,236,238) → #8C0A20 (140,10,32)
  const r = Math.round(253 + (140 - 253) * t);
  const g = Math.round(236 + (10 - 236) * t);
  const b = Math.round(238 + (32 - 238) * t);
  const text = t <= 0.55 ? '#0F1F17' : '#FFFFFF';
  return { bg: `rgb(${r}, ${g}, ${b})`, text, intensity };
}


/**
 * Leak heatmap — the signature data-viz. Each tile is a leaking (product,
 * supplier) pair, colored by how far the last price exceeds its baseline, with
 * a danger shadow that intensifies with the leak, sorted by monthly money lost.
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
                  ? `0 0 0 1px rgba(140,10,32,${0.2 + intensity * 0.3}), 0 8px 22px -12px rgba(140,10,32,${0.25 + intensity * 0.25})`
                  : undefined,
              }}
              title={`${c.productName} · ${c.supplierName}: +${pct(c.deltaPct)} · ${fmtIls(c.monthExcessIls)}`}
            >
              <div className="font-mono text-lg font-extrabold tabular-nums" dir="ltr">
                +{pct(c.deltaPct)}
              </div>
              <div className="mt-1 truncate text-sm font-semibold">{c.productName}</div>
              <div className="truncate text-xs">{c.supplierName}</div>
              <div className="mt-2 font-mono text-xs font-semibold tabular-nums">
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
            style={{ background: 'linear-gradient(90deg, #FDECEE, #8C0A20)' }}
            aria-hidden="true"
          />
          <span>{l.severe}</span>
        </div>
        {hidden > 0 ? <span>{l.more.replace('{count}', String(hidden))}</span> : null}
      </div>
    </div>
  );
}
