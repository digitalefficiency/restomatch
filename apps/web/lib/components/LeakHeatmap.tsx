import { formatIls } from '../money';
import type { Locale } from '../i18n/config';
import { formatPercent } from '../i18n/format';
import { creepStep } from './data-viz/palette';
import { drillAttrs } from './drill/attrs';
import { cnMerge as cn } from './cn';

export interface LeakCell {
  productName: string;
  supplierName: string;
  deltaPct: number;
  monthExcessIls: number;
  category?: string | null;
  /** W2-09c: where the tile drills to (its row in the "מחירים שעלו" table). Without it the tile is not a link. */
  href?: string;
}

/** Price creep (~5%..50%+ over the usual price) → a 0..1 intensity for the creep ramp (tokens). */
function creepIntensity(deltaPct: number): number {
  return Math.max(0.12, Math.min(1, (deltaPct - 0.05) / 0.45));
}

/**
 * Leak heatmap — the signature data-viz. Each tile is a (product, supplier)
 * pair whose price rose, coloured by the creep ramp tokens by how far the last
 * price exceeds the usual one, sorted by money paid above it. Every tile prints
 * its values (colour is never the only signal) and has a full-sentence name;
 * with `href` it is a door (a11y-19, the drill contract). Server-safe (no hooks).
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
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-record="">
        {shown.map((c, i) => {
          const { bg, text, step } = creepStep(creepIntensity(c.deltaPct));
          const name = `${c.productName} · ${c.supplierName}: +${pct(c.deltaPct)} · ${fmtIls(c.monthExcessIls)}`;
          const cls = cn(
            'relative block overflow-hidden rounded-xl p-3 ring-1 ring-line transition-transform',
            bg,
            text,
            step >= 4 && 'shadow-md',
            c.href && 'hover:scale-[1.03]',
          );
          const body = (
            <>
              <div className="text-lg font-extrabold tabular-nums">
                <bdi>+{pct(c.deltaPct)}</bdi>
              </div>
              <div className="mt-1 truncate text-sm font-semibold">{c.productName}</div>
              <div className="truncate text-xs">{c.supplierName}</div>
              <div className="mt-2 text-xs font-semibold tabular-nums">
                <bdi>{fmtIls(c.monthExcessIls)}</bdi>
              </div>
            </>
          );
          const key = `${c.productName}-${c.supplierName}-${i}`;
          return (
            <li key={key} className="list-none">
              {c.href ? (
                <a href={c.href} className={cls} {...drillAttrs(Math.round(c.monthExcessIls * 100))} data-testid="heatmap-tile">
                  {body}
                </a>
              ) : (
                <div className={cls} aria-label={name} role="group" data-testid="heatmap-tile">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <div className="flex items-center gap-2">
          <span>{l.mild}</span>
          <span className="flex h-3 w-24 overflow-hidden rounded-full ring-1 ring-line" aria-hidden="true">
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((x) => (
              <span key={x} className={cn('h-full flex-1', creepStep(x).bg)} />
            ))}
          </span>
          <span>{l.severe}</span>
        </div>
        {hidden > 0 ? <span data-record="">{l.more.replace('{count}', String(hidden))}</span> : null}
      </div>
    </div>
  );
}
