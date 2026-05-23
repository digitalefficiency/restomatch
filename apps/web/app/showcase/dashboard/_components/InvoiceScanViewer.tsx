'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  Camera,
  Check,
  Download,
  Eye,
  EyeOff,
  FileText,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ScanLine {
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  /** OCR confidence per line (0..1). When omitted, defaults to invoice-level confidence. */
  confidence?: number;
  /** Optional hand-written/stamped correction (e.g. driver wrote -2 in pen). */
  correction?: { value: string; tone: 'red' | 'blue' };
}

export interface ScanData {
  supplierName: string;
  supplierInitials: string;
  supplierBusinessId: string;
  /** Header band color — supplier brand color. Tailwind-friendly hex. */
  supplierColor: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerBusinessId: string;
  lines: ScanLine[];
  /** Overall OCR confidence 0..1. */
  ocrConfidence: number;
  /** Optional camera/source label shown in viewer header. */
  capturedBy?: string;
  /** Optional notes scrawled on the scan (e.g. driver signature). */
  driverSignature?: string;
}

interface Props {
  data: ScanData;
  onClose: () => void;
}

export function InvoiceScanViewer({ data, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [showOcrOverlay, setShowOcrOverlay] = useState(false);
  const [zoom, setZoom] = useState(1);

  useGSAP(
    () => {
      gsap.fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.2 });
      gsap.fromTo(
        sheetRef.current,
        { y: 24, opacity: 0, scale: 0.98 },
        { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'power3.out' },
      );
    },
    { dependencies: [data.invoiceNumber] },
  );

  // Body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'o' || e.key === 'O') setShowOcrOverlay((v) => !v);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const subtotal = useMemo(
    () => data.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0),
    [data.lines],
  );
  const vat = subtotal * 0.17;
  const total = subtotal + vat;

  const dateText = new Date(data.invoiceDate).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 sm:p-8"
      dir="rtl"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-2xl max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Viewer toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-blue-700" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-slate-900 truncate">
                  סריקת חשבונית {data.invoiceNumber}
                </span>
                <ConfidenceBadge value={data.ocrConfidence} />
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                <Camera className="w-3 h-3" />
                <span>{data.capturedBy ?? 'נסרק מטלפון'}</span>
                <span className="text-slate-300">·</span>
                <span>{dateText}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
              className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center"
              title="הקטן"
            >
              <ZoomOut className="w-4 h-4 text-slate-700" />
            </button>
            <span className="text-xs tabular-nums text-slate-500 w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
              className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center"
              title="הגדל"
            >
              <ZoomIn className="w-4 h-4 text-slate-700" />
            </button>
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <button
              type="button"
              onClick={() => setShowOcrOverlay((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium transition-all ${
                showOcrOverlay
                  ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,0.25)]'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
              title="הצג/הסתר OCR overlay (O)"
            >
              {showOcrOverlay ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showOcrOverlay ? 'הסתר OCR' : 'הצג OCR'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700"
              title="הורד את הסריקה המקורית"
            >
              <Download className="w-3.5 h-3.5" />
              הורד
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
              title="סגור"
            >
              <X className="w-4 h-4 text-slate-700" />
            </button>
          </div>
        </div>

        {/* Body: scan canvas + extraction panel */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Scan canvas */}
          <div
            className="flex-1 overflow-auto bg-gradient-to-br from-slate-100 via-slate-100/80 to-slate-200/60 p-6 sm:p-10"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          >
            <div
              className="mx-auto transition-transform duration-200"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
                width: 'fit-content',
              }}
            >
              <InvoicePaper
                data={data}
                subtotal={subtotal}
                vat={vat}
                total={total}
                showOcrOverlay={showOcrOverlay}
              />
            </div>
          </div>

          {/* Extraction sidebar */}
          <aside className="w-80 shrink-0 border-r border-slate-200 bg-white overflow-y-auto hidden lg:block">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
                שדות שחולצו
              </div>
              <div className="text-xs text-slate-500">
                ה-OCR זיהה את השדות הבאים. ביטחון כללי{' '}
                <span className="font-bold text-slate-700 tabular-nums">
                  {Math.round(data.ocrConfidence * 100)}%
                </span>
                .
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              <ExtractedField label="ספק" value={data.supplierName} confidence={0.99} />
              <ExtractedField label="ח.פ. ספק" value={data.supplierBusinessId} confidence={0.97} mono />
              <ExtractedField label="מס׳ חשבונית" value={data.invoiceNumber} confidence={0.98} mono />
              <ExtractedField label="תאריך" value={dateText} confidence={0.94} mono />
              <ExtractedField label="לקוח" value={data.customerName} confidence={0.91} />
              <ExtractedField
                label="סה״כ כולל מע״מ"
                value={`₪${total.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                confidence={0.99}
                mono
                emphasize
              />
            </div>

            <div className="border-t border-slate-100 px-5 py-4">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                <span>שורות שחולצו ({data.lines.length})</span>
              </div>
              <ul className="space-y-2">
                {data.lines.map((line, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 text-xs px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-100"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">{line.name}</div>
                      <div className="text-[10px] text-slate-500 tabular-nums">
                        {line.qty} {line.unit} × ₪{line.unitPrice.toFixed(2)}
                      </div>
                    </div>
                    <ConfidenceDot value={line.confidence ?? data.ocrConfidence} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-slate-100 px-5 py-4">
              <div className="rounded-xl bg-blue-50/60 border border-blue-200/70 px-3 py-2.5 text-xs text-blue-900 flex items-start gap-2">
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-600" strokeWidth={3} />
                <div>
                  הסריקה נשמרה כמסמך-מקור immutable עם hash. עומדת בדרישות תיעוד של רשות המסים.
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice paper renderer (SVG-styled)
// ---------------------------------------------------------------------------

function InvoicePaper({
  data,
  subtotal,
  vat,
  total,
  showOcrOverlay,
}: {
  data: ScanData;
  subtotal: number;
  vat: number;
  total: number;
  showOcrOverlay: boolean;
}) {
  const dateText = new Date(data.invoiceDate).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div
      className="relative bg-[#fdfcf8] shadow-[0_24px_64px_-24px_rgba(15,23,42,0.35),0_4px_12px_rgba(15,23,42,0.08)] rounded-md"
      style={{
        width: 720,
        minHeight: 1020,
        transform: 'rotate(-0.4deg)',
        fontFamily: '"Heebo", system-ui, sans-serif',
      }}
    >
      {/* Subtle paper grain */}
      <div
        className="absolute inset-0 rounded-md pointer-events-none opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            'repeating-linear-gradient(90deg, rgba(0,0,0,0.4) 0, rgba(0,0,0,0.4) 1px, transparent 1px, transparent 4px)',
        }}
      />
      {/* Camera glare */}
      <div
        className="absolute inset-0 rounded-md pointer-events-none opacity-40"
        style={{
          background:
            'radial-gradient(ellipse 50% 30% at 80% 12%, rgba(255,255,255,0.5), transparent 70%)',
        }}
      />

      {/* Supplier header band */}
      <div
        className="rounded-t-md px-8 py-5 flex items-center justify-between"
        style={{ background: `linear-gradient(135deg, ${data.supplierColor}, ${shade(data.supplierColor, -15)})` }}
      >
        <div className="text-white">
          <div className="text-2xl font-extrabold tracking-tight">{data.supplierName}</div>
          <div className="text-xs opacity-90 mt-0.5">ח.פ. {data.supplierBusinessId}</div>
        </div>
        <div
          className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white font-bold text-xl"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {data.supplierInitials}
        </div>
      </div>

      {/* Document body */}
      <div className="px-8 pt-7 pb-10 text-slate-900 relative">
        {/* Title row */}
        <div className="flex items-start justify-between mb-7 relative">
          <h1 className="text-3xl font-bold tracking-tight">חשבונית מס</h1>
          <div className="text-left text-sm space-y-0.5">
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-slate-500">מס׳ חשבונית:</span>
              <FieldBox highlight={showOcrOverlay} confidence={0.98}>
                <span className="font-bold tabular-nums">{data.invoiceNumber}</span>
              </FieldBox>
            </div>
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-slate-500">תאריך:</span>
              <FieldBox highlight={showOcrOverlay} confidence={0.94}>
                <span className="font-medium tabular-nums">{dateText}</span>
              </FieldBox>
            </div>
          </div>
        </div>

        {/* Customer block */}
        <div className="bg-slate-50/80 rounded-lg px-5 py-3 mb-7 border border-slate-200/60">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
            לכבוד
          </div>
          <FieldBox highlight={showOcrOverlay} confidence={0.91}>
            <span className="font-bold">{data.customerName}</span>
          </FieldBox>
          <div className="text-xs text-slate-500 mt-1">ח.פ. {data.customerBusinessId}</div>
        </div>

        {/* Lines table */}
        <div className="overflow-hidden border border-slate-200 rounded-lg mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100/60 text-slate-700">
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider">
                  #
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider">
                  תיאור
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider tabular-nums">
                  כמות
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider tabular-nums">
                  מחיר ליחידה
                </th>
                <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wider tabular-nums">
                  סה״כ
                </th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, i) => (
                <tr
                  key={i}
                  className={`border-t border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                >
                  <td className="px-3 py-2.5 text-slate-500 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <FieldBox highlight={showOcrOverlay} confidence={line.confidence ?? data.ocrConfidence}>
                      <span className="font-medium">{line.name}</span>
                    </FieldBox>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <FieldBox highlight={showOcrOverlay} confidence={line.confidence ?? data.ocrConfidence}>
                      {line.qty} {line.unit}
                    </FieldBox>
                    {line.correction ? (
                      <div className="mt-0.5 text-xs">
                        <PenScrawl tone={line.correction.tone}>{line.correction.value}</PenScrawl>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <FieldBox highlight={showOcrOverlay} confidence={line.confidence ?? data.ocrConfidence}>
                      ₪{line.unitPrice.toFixed(2)}
                    </FieldBox>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums font-semibold">
                    ₪{(line.qty * line.unitPrice).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-start">
          <div className="w-72 space-y-1.5 text-sm">
            <TotalRow label="סכום ביניים" value={subtotal} />
            <TotalRow label="מע״מ 17%" value={vat} />
            <div className="border-t-2 border-slate-300 my-1.5" />
            <div className="flex items-baseline justify-between bg-slate-900 text-white px-3 py-2 rounded-md">
              <span className="text-xs uppercase tracking-wider opacity-80">סה״כ לתשלום</span>
              <FieldBox highlight={showOcrOverlay} confidence={0.99} tone="emerald">
                <span className="font-bold tabular-nums text-base">
                  ₪{total.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </FieldBox>
            </div>
          </div>
        </div>

        {/* Driver signature line */}
        <div className="mt-10 flex items-end justify-between border-t border-dashed border-slate-300 pt-4 text-xs text-slate-500">
          <div>
            <div>תנאי תשלום: שוטף +30</div>
            <div className="mt-0.5">חתימת נהג:</div>
            {data.driverSignature ? (
              <PenScrawl tone="blue" className="text-base mt-1">
                {data.driverSignature}
              </PenScrawl>
            ) : (
              <div className="w-32 border-b border-slate-400 mt-3" />
            )}
          </div>
          <div className="text-right opacity-70">
            תודה רבה ויום נעים!
            <br />
            {data.supplierName}
          </div>
        </div>
      </div>

      {/* Tape / corner sticker */}
      <div
        className="absolute -top-1 right-12 w-16 h-6 bg-gradient-to-b from-amber-200/70 to-amber-300/70 rounded-sm shadow-sm"
        style={{ transform: 'rotate(-3deg)' }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function FieldBox({
  children,
  highlight,
  confidence = 1,
  tone = 'blue',
}: {
  children: React.ReactNode;
  highlight: boolean;
  confidence?: number;
  tone?: 'blue' | 'emerald';
}) {
  if (!highlight) return <>{children}</>;
  const color =
    tone === 'emerald'
      ? confidence > 0.9
        ? 'ring-emerald-400 bg-emerald-50/60'
        : confidence > 0.75
          ? 'ring-amber-400 bg-amber-50/60'
          : 'ring-red-400 bg-red-50/60'
      : confidence > 0.9
        ? 'ring-blue-400 bg-blue-50/50'
        : confidence > 0.75
          ? 'ring-amber-400 bg-amber-50/60'
          : 'ring-red-400 bg-red-50/60';
  return (
    <span
      className={`relative inline-block px-1 rounded ring-2 ring-offset-1 ring-offset-transparent ${color}`}
      title={`OCR confidence: ${Math.round(confidence * 100)}%`}
    >
      {children}
    </span>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium tabular-nums">
        ₪{value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function PenScrawl({
  children,
  tone,
  className = '',
}: {
  children: React.ReactNode;
  tone: 'red' | 'blue';
  className?: string;
}) {
  const color = tone === 'red' ? 'text-red-600' : 'text-blue-700';
  return (
    <span
      className={`${color} ${className}`}
      style={{
        fontFamily: '"Caveat", "Heebo", cursive',
        fontSize: '1.05em',
        transform: 'rotate(-2deg)',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.92
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : value >= 0.8
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      OCR {pct}%
    </span>
  );
}

function ConfidenceDot({ value }: { value: number }) {
  const tone =
    value >= 0.92 ? 'bg-emerald-500' : value >= 0.8 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${tone}`}
      title={`${Math.round(value * 100)}%`}
    />
  );
}

function ExtractedField({
  label,
  value,
  confidence,
  mono,
  emphasize,
}: {
  label: string;
  value: string;
  confidence: number;
  mono?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-slate-400">
          {Math.round(confidence * 100)}%
        </span>
      </div>
      <div
        className={`text-sm ${mono ? 'font-mono' : ''} ${
          emphasize ? 'font-bold text-blue-700' : 'text-slate-800'
        }`}
      >
        {value}
      </div>
      <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            confidence >= 0.92
              ? 'bg-emerald-500'
              : confidence >= 0.8
                ? 'bg-amber-500'
                : 'bg-red-500'
          }`}
          style={{ width: `${Math.round(confidence * 100)}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color helper — lighten/darken a hex by percent
// ---------------------------------------------------------------------------

function shade(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}
