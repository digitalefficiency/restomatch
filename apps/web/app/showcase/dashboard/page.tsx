'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileCheck2,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useRef, useState } from 'react';

interface Kpi {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  delta: number;
  tone: 'warn' | 'good' | 'neutral';
  icon: React.ReactNode;
}

const KPIS: Kpi[] = [
  {
    label: 'הפסד פוטנציאלי החודש',
    value: 4820,
    prefix: '₪',
    delta: 12,
    tone: 'warn',
    icon: <AlertCircle className="w-5 h-5" />,
  },
  {
    label: 'חיסכון שנשמר',
    value: 12340,
    prefix: '₪',
    delta: 34,
    tone: 'good',
    icon: <Wallet className="w-5 h-5" />,
  },
  {
    label: 'ממתינות לאישור',
    value: 7,
    delta: -2,
    tone: 'neutral',
    icon: <FileCheck2 className="w-5 h-5" />,
  },
];

interface HeatCell {
  variance: number;
  series: number[];
  basePrice: number;
}

const PRODUCTS = ['עגבניה שרי', 'מלפפון', 'חסה', 'אנטריקוט', 'סלמון', 'חזה עוף', 'לחמניות', 'בצל'];
const SUPPLIERS = ['ירקני אבי', 'קצביית הכרם', 'דגי קובי', 'מאפיית ברנס'];

const HEATMAP: HeatCell[][] = PRODUCTS.map((_, pIdx) =>
  SUPPLIERS.map((_, sIdx) => {
    const seed = (pIdx * 37 + sIdx * 13) % 100;
    const variance = (seed - 50) / 50;
    const basePrice = 5 + (seed % 30);
    const series = Array.from({ length: 12 }, (__, w) => {
      const trend = (w / 11) * variance * basePrice * 0.4;
      const noise = Math.sin(w * 1.7 + pIdx) * basePrice * 0.05;
      return basePrice + trend + noise;
    });
    return { variance, series, basePrice };
  }),
);

interface FlowEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  type: 'block' | 'approve' | 'flag' | 'sync';
}

const EVENTS: FlowEvent[] = [
  {
    id: '1',
    time: '09:35',
    title: 'חשבונית כפולה זוהתה',
    detail: 'INV-4882 מקצביית הכרם — נחסמה אוטומטית',
    type: 'block',
  },
  {
    id: '2',
    time: '09:28',
    title: 'PO #1235 התקבל מלא',
    detail: 'יוסי אישר 8 פריטים · ₪3,420',
    type: 'approve',
  },
  {
    id: '3',
    time: '09:14',
    title: 'חריגת מחיר ממתינה לאישור',
    detail: 'עגבניה שרי — עלייה 21% מעל ממוצע 60 ימים',
    type: 'flag',
  },
  {
    id: '4',
    time: '08:30',
    title: 'סנכרון Market Man',
    detail: '14 הזמנות חדשות נכנסו ל-PO queue',
    type: 'sync',
  },
  {
    id: '5',
    time: '08:05',
    title: 'PO #1234 בקבלה',
    detail: 'ירקני אבי — 12 פריטים בתהליך',
    type: 'flag',
  },
];

export default function DashboardShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.section-block', {
        y: 30,
        opacity: 0,
        stagger: 0.15,
        duration: 0.7,
        ease: 'power3.out',
      });
    },
    { scope: containerRef },
  );

  return (
    <main ref={containerRef} className="max-w-7xl mx-auto px-6 py-12 space-y-12" dir="rtl">
      <div className="section-block">
        <p className="text-xs uppercase tracking-[0.2em] text-blue-600 font-semibold mb-2">
          Control Center
        </p>
        <h1 className="text-4xl font-bold tracking-tight mb-2 text-slate-900">לוח הבעלים</h1>
        <p className="text-slate-500">
          תמונה לייב של המסעדה — איפה כסף בורח, מי ספק מדויק, מה דורש את ההחלטה שלך עכשיו.
        </p>
      </div>

      <div className="section-block">
        <KpiRow />
      </div>

      <div className="section-block grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SectionHeader title="בלש הדליפות" subtitle="סטיית מחיר אחרון מול ממוצע היסטורי" />
          <Heatmap />
        </div>
        <div>
          <SectionHeader title="Live Flow" subtitle="אירועים בזמן אמת" />
          <LiveFlow />
        </div>
      </div>
    </main>
  );
}

function KpiRow() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {KPIS.map((k) => (
        <KpiCard key={k.label} kpi={k} />
      ))}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (!numberRef.current) return;
      const obj = { value: 0 };
      gsap.to(obj, {
        value: kpi.value,
        duration: 1.6,
        ease: 'power2.out',
        onUpdate: () => {
          if (numberRef.current) {
            numberRef.current.textContent = Math.round(obj.value).toLocaleString('he-IL');
          }
        },
      });
    },
    { scope: cardRef },
  );

  const tones = {
    good: {
      icon: 'text-emerald-600 bg-emerald-50 ring-emerald-100',
      glow: 'bg-emerald-400',
      number: 'text-slate-900',
    },
    warn: {
      icon: 'text-amber-600 bg-amber-50 ring-amber-100',
      glow: 'bg-amber-400',
      number: 'text-slate-900',
    },
    neutral: {
      icon: 'text-blue-600 bg-blue-50 ring-blue-100',
      glow: 'bg-blue-400',
      number: 'text-slate-900',
    },
  } as const;
  const t = tones[kpi.tone];

  const deltaPositive = kpi.delta >= 0;
  const deltaColor =
    kpi.tone === 'good'
      ? 'text-emerald-600'
      : kpi.tone === 'warn'
        ? 'text-red-600'
        : deltaPositive
          ? 'text-red-600'
          : 'text-emerald-600';

  return (
    <div
      ref={cardRef}
      className="relative rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-6 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.06)]"
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ring-1 ${t.icon}`}
        >
          {kpi.icon}
        </div>
        <div className={`flex items-center gap-1 text-xs font-semibold ${deltaColor}`}>
          {deltaPositive ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          <span>
            {kpi.delta > 0 ? '+' : ''}
            {kpi.delta}%
          </span>
        </div>
      </div>

      <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
        {kpi.label}
      </div>
      <div className="text-4xl font-bold tabular-nums tracking-tight flex items-baseline gap-1">
        {kpi.prefix ? <span className="text-2xl text-slate-400">{kpi.prefix}</span> : null}
        <span ref={numberRef} className={t.number}>
          0
        </span>
        {kpi.suffix ? <span className="text-2xl text-slate-400">{kpi.suffix}</span> : null}
      </div>

      <div
        className={`pointer-events-none absolute -bottom-12 -right-12 w-48 h-48 rounded-full blur-3xl opacity-[0.12] ${t.glow}`}
      />
    </div>
  );
}

function Heatmap() {
  const [hover, setHover] = useState<{ p: number; s: number; x: number; y: number } | null>(null);

  return (
    <div className="relative rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.06)]">
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `120px repeat(${SUPPLIERS.length}, 1fr)` }}
      >
        <div />
        {SUPPLIERS.map((s) => (
          <div key={s} className="text-xs text-slate-500 font-medium text-center pb-3 px-1">
            {s}
          </div>
        ))}

        {PRODUCTS.map((product, pIdx) => (
          <div key={product} className="contents">
            <div className="text-sm font-medium text-slate-700 pr-3 py-1 flex items-center">
              {product}
            </div>
            {SUPPLIERS.map((_, sIdx) => {
              const cell = HEATMAP[pIdx]?.[sIdx];
              if (!cell) return null;
              return (
                <button
                  key={`${pIdx}-${sIdx}`}
                  type="button"
                  className="relative aspect-square m-0.5 rounded-md transition-all hover:scale-110 hover:z-10 hover:ring-2 hover:ring-blue-300 focus:outline-none flex items-center justify-center"
                  style={{
                    background: cellColor(cell.variance),
                    boxShadow:
                      cell.variance > 0.5
                        ? `0 0 16px ${cellColor(cell.variance, 0.4)}`
                        : 'inset 0 0 0 1px rgba(15,23,42,0.04)',
                  }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHover({
                      p: pIdx,
                      s: sIdx,
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  <span
                    className={`text-[10px] font-bold tabular-nums ${
                      Math.abs(cell.variance) > 0.4 ? 'text-white' : 'text-slate-700'
                    }`}
                  >
                    {cell.variance > 0 ? '+' : ''}
                    {(cell.variance * 100).toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center gap-6 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ background: cellColor(-0.7) }} />
          <span>זול מהממוצע</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ background: cellColor(0) }} />
          <span>בממוצע</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm" style={{ background: cellColor(0.7) }} />
          <span>חריגה מעלה</span>
        </div>
      </div>

      {hover ? <HeatTooltip hover={hover} /> : null}
    </div>
  );
}

function cellColor(variance: number, alpha = 1): string {
  // -1 = emerald (cheap), 0 = neutral white-ish, +1 = red (expensive)
  if (variance <= 0) {
    const t = Math.abs(variance);
    // White → emerald-500
    const r = Math.round(255 + (16 - 255) * t);
    const g = Math.round(255 + (185 - 255) * t);
    const b = Math.round(255 + (129 - 255) * t);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const t = variance;
  // White → red-600
  const r = Math.round(255 + (220 - 255) * t);
  const g = Math.round(255 + (38 - 255) * t);
  const b = Math.round(255 + (38 - 255) * t);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function HeatTooltip({ hover }: { hover: { p: number; s: number; x: number; y: number } }) {
  const cell = HEATMAP[hover.p]?.[hover.s];
  if (!cell) return null;
  const product = PRODUCTS[hover.p];
  const supplier = SUPPLIERS[hover.s];

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: hover.x,
        top: hover.y - 12,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl p-3 min-w-[220px] shadow-[0_8px_24px_-8px_rgba(15,23,42,0.18),0_4px_8px_-4px_rgba(15,23,42,0.08)]">
        <div className="text-xs text-slate-500 mb-0.5">{supplier}</div>
        <div className="font-semibold text-sm mb-2 text-slate-900">{product}</div>
        <Sparkline data={cell.series} variance={cell.variance} />
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-slate-500">12 שבועות אחרונים</span>
          <span
            className={`font-bold tabular-nums ${
              cell.variance > 0 ? 'text-red-600' : 'text-emerald-600'
            }`}
          >
            {cell.variance > 0 ? '+' : ''}
            {(cell.variance * 100).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ data, variance }: { data: number[]; variance: number }) {
  const w = 200;
  const h = 50;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const stroke = variance > 0 ? '#DC2626' : '#059669';
  const fillStart = variance > 0 ? 'rgba(220,38,38,0.18)' : 'rgba(5,150,105,0.18)';
  const fillEnd = variance > 0 ? 'rgba(220,38,38,0)' : 'rgba(5,150,105,0)';
  const gradId = `g-${variance > 0 ? 'r' : 'g'}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillStart} />
          <stop offset="100%" stopColor={fillEnd} />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      {points.length > 0 ? (
        <circle
          cx={points[points.length - 1]![0]}
          cy={points[points.length - 1]![1]}
          r="3"
          fill={stroke}
        />
      ) : null}
    </svg>
  );
}

function LiveFlow() {
  const containerRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.flow-event', {
        x: -20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.5,
        ease: 'power2.out',
        delay: 0.3,
      });

      gsap.to('.flow-radar', {
        scale: 2.4,
        opacity: 0,
        duration: 1.6,
        ease: 'power1.out',
        repeat: -1,
        stagger: 0.2,
      });
    },
    { scope: containerRef },
  );

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur-xl p-6 overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-8px_rgba(15,23,42,0.06)]"
    >
      <div className="relative pr-2">
        <div className="absolute top-2 bottom-2 right-[14px] w-px bg-gradient-to-b from-blue-300/70 via-slate-200 to-transparent" />
        <div className="space-y-5">
          {EVENTS.map((e) => (
            <FlowEventRow key={e.id} event={e} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FlowEventRow({ event }: { event: FlowEvent }) {
  const colorMap = {
    block: {
      dot: 'bg-red-600',
      label: 'text-red-600',
      icon: <ShieldAlert className="w-3.5 h-3.5" />,
    },
    approve: {
      dot: 'bg-emerald-600',
      label: 'text-emerald-600',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    },
    flag: {
      dot: 'bg-amber-500',
      label: 'text-amber-600',
      icon: <AlertCircle className="w-3.5 h-3.5" />,
    },
    sync: {
      dot: 'bg-blue-500',
      label: 'text-blue-600',
      icon: <Clock className="w-3.5 h-3.5" />,
    },
  } as const;

  const colors = colorMap[event.type];

  return (
    <div className="flow-event relative flex items-start gap-3">
      <div className="relative shrink-0 mt-1">
        {event.type === 'block' ? (
          <span className={`flow-radar absolute inset-0 rounded-full ${colors.dot} opacity-60`} />
        ) : null}
        <span className={`relative block w-3 h-3 rounded-full ${colors.dot} ring-4 ring-white`} />
      </div>
      <div className="flex-1 pb-1">
        <div className="flex items-center justify-between mb-0.5">
          <div
            className={`flex items-center gap-1.5 text-xs font-semibold ${colors.label}`}
          >
            {colors.icon}
            <span>{event.time}</span>
          </div>
        </div>
        <div className="text-sm font-medium text-slate-800">{event.title}</div>
        <div className="text-xs text-slate-500 mt-0.5">{event.detail}</div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
      <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
    </div>
  );
}
