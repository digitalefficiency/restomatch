'use client';

import { useState } from 'react';
import { TrendingDown, ShieldCheck } from 'lucide-react';

/**
 * Deterministic ₪ formatter. Intl.NumberFormat('he-IL', currency) renders
 * differently under Node's ICU (SSR) vs the browser's (whitespace / RTL marks),
 * which trips a React hydration mismatch — so format by hand instead.
 */
function ils(n: number): string {
  return `₪${Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

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
            className="mb-1.5 block text-sm font-medium text-muted"
          >
            רכש חודשי מספקים
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-subtle">
              ₪
            </span>
            <input
              id="roi-monthly"
              type="number"
              min={0}
              step={1000}
              value={monthly}
              onChange={(e) => setMonthly(Math.max(0, Number(e.target.value) || 0))}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 pr-8 font-mono text-lg font-bold tabular-nums text-ink transition-colors placeholder-subtle focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="roi-leak" className="text-sm font-medium text-muted">
              אחוז דליפה משוער
            </label>
            <span className="font-mono text-sm font-bold tabular-nums text-primary">
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
          <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-subtle">
            <span>0.5%</span>
            <span>5%</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            מחירים שעלו בלי שאישרתם, סחורה שלא הגיעה, כפילויות וטעויות הקלדה —
            במסעדה ממוצעת מדובר ב‑1%–2% מהרכש.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-2xl border border-danger/25 bg-danger/8 p-5 shadow-glow-danger">
          <span aria-hidden="true" className="absolute inset-y-0 right-0 w-0.5 leak-gradient" />
          <div className="flex items-center gap-2 text-danger">
            <TrendingDown className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">הפסד שנתי משוער</span>
          </div>
          <p className="mt-2 font-mono text-4xl font-extrabold tabular-nums tracking-tight text-danger drop-shadow-glow-danger">
            {ils(annualLoss)}
          </p>
          <p className="mt-1 text-sm text-muted">
            כסף שדולף בקבלת הסחורה — בכל שנה, מחדש.
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-gold/25 bg-gold/8 p-5 shadow-glow-gold">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
          <div className="flex items-center gap-2 text-gold">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-semibold">RestoMatch מחזירה עד</span>
          </div>
          <p className="mt-2 font-mono text-4xl font-extrabold tabular-nums tracking-tight text-gold drop-shadow-glow-gold">
            {ils(recovered)}
          </p>
          <p className="mt-1 text-sm text-muted">
            על בסיס תפיסה של כ‑{Math.round(RECOVERY_RATE * 100)}% מהדליפות עוד לפני
            שמשלמים.
          </p>
        </div>
      </div>
    </div>
  );
}
