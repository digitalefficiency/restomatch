'use client';

import { useState } from 'react';
import { TrendingDown, ShieldCheck } from 'lucide-react';

const ils = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});

/**
 * Interactive ROI / leak calculator. The visitor enters monthly procurement (₪)
 * and a leak %; we show the estimated annual loss and how much RestoMatch
 * recovers. Pure presentational math — no backend.
 */
export function RoiCalculator() {
  const [monthly, setMonthly] = useState(100_000);
  const [leakPct, setLeakPct] = useState(1.5);

  // Conservative recovery assumption — RestoMatch catches most leaks at receiving.
  const RECOVERY_RATE = 0.7;

  const annualLoss = monthly * 12 * (leakPct / 100);
  const recovered = annualLoss * RECOVERY_RATE;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        <div>
          <label
            htmlFor="roi-monthly"
            className="mb-1.5 block text-sm font-medium text-stone-700"
          >
            רכש חודשי מספקים
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-stone-400">
              ₪
            </span>
            <input
              id="roi-monthly"
              type="number"
              min={0}
              step={1000}
              value={monthly}
              onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 pr-8 text-lg font-semibold text-ink tabular-nums transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="roi-leak" className="text-sm font-medium text-stone-700">
              אחוז דליפה משוער
            </label>
            <span className="text-sm font-bold text-primary tabular-nums">
              {leakPct.toFixed(1)}%
            </span>
          </div>
          <input
            id="roi-leak"
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={leakPct}
            onChange={(e) => setLeakPct(Number(e.target.value))}
            className="w-full cursor-pointer accent-primary"
            aria-valuetext={`${leakPct.toFixed(1)} אחוז`}
          />
          <div className="mt-1 flex justify-between text-xs text-stone-400 tabular-nums">
            <span>0.5%</span>
            <span>5%</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-stone-500">
            מחירים שעלו בלי שאישרתם, סחורה שלא הגיעה, כפילויות וטעויות הקלדה —
            במסעדה ממוצעת מדובר ב‑1%–2% מהרכש.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-danger/20 bg-danger/5 p-5">
          <div className="flex items-center gap-2 text-danger">
            <TrendingDown className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">הפסד שנתי משוער</span>
          </div>
          <p className="mt-2 text-4xl font-bold tracking-tight text-danger tabular-nums">
            {ils.format(annualLoss)}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            כסף שדולף בקבלת הסחורה — בכל שנה, מחדש.
          </p>
        </div>

        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">RestoMatch מחזירה עד</span>
          </div>
          <p className="mt-2 text-4xl font-bold tracking-tight text-primary tabular-nums">
            {ils.format(recovered)}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            על בסיס תפיסה של כ‑{Math.round(RECOVERY_RATE * 100)}% מהדליפות עוד לפני
            שמשלמים.
          </p>
        </div>
      </div>
    </div>
  );
}
