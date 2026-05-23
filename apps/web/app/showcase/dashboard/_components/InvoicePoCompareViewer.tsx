'use client';

/**
 * Side-by-side comparison of the original Purchase Order document and the
 * invoice scan from the supplier. Each line is highlighted with a matching
 * coloured ring on both sides so the owner can eyeball "this is what I
 * ordered, this is what they billed me".
 *
 * Both papers are rendered as styled HTML+CSS (not real PDFs) so they
 * remain crisp at any zoom and respond to dark/light backgrounds.
 */

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Download,
  FileText,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface CompareLine {
  productName: string;
  unit: string;
  poQty: number | null;
  poUnitPrice: number | null;
  invoiceQty: number | null;
  invoiceUnitPrice: number | null;
  status:
    | 'matched'
    | 'qty_short'
    | 'qty_over'
    | 'price_higher'
    | 'price_lower'
    | 'unordered'
    | 'missing_from_invoice';
  variance: number;
  note?: string;
}

export interface CompareData {
  supplierName: string;
  supplierInitials: string;
  supplierBusinessId: string;
  supplierColor: string;
  customerName: string;
  customerBusinessId: string;

  poNumber: string;
  poIssuedAt: string;
  poExpectedAt: string;
  poApprovedBy: string;

  invoiceNumber: string;
  invoiceDate: string;
  ocrConfidence: number;
  /** Database-backed URL of the original scanned invoice (loaded via iframe). */
  rawImageUrl: string;
}

interface Props {
  data: CompareData;
  lines: CompareLine[];
  onClose: () => void;
}

type LineKey = string;

function lineKey(line: CompareLine, idx: number): LineKey {
  return `${line.productName}-${idx}`;
}

export function InvoicePoCompareViewer({ data, lines, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.72);
  const [focusKey, setFocusKey] = useState<LineKey | null>(null);

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

  // Body scroll lock + ESC + zoom shortcuts
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(1.4, z + 0.1));
      if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.1));
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', handler);
    };
  }, [onClose]);

  const stats = useMemo(() => computeStats(lines), [lines]);

  const issueLines = lines.filter((l) => l.status !== 'matched');

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-md flex items-stretch justify-center p-2 sm:p-4"
      dir="rtl"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[1400px] max-h-[96vh] flex flex-col overflow-hidden"
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50/60">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
              <ClipboardList className="w-5 h-5 text-blue-700" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                <span>השוואה צד-לצד:</span>
                <span className="font-mono text-slate-700">{data.poNumber}</span>
                <span className="text-slate-300">↔</span>
                <span className="font-mono text-slate-700">{data.invoiceNumber}</span>
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                <span>{data.supplierName}</span>
                <span className="text-slate-300">·</span>
                <DiffStatBadge stats={stats} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
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
              onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
              className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center"
              title="הגדל"
            >
              <ZoomIn className="w-4 h-4 text-slate-700" />
            </button>
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700"
              title="הורד את שני המסמכים"
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

        {/* Body: 2 papers + diff panel */}
        <div className="flex-1 min-h-0 flex">
          {/* Diff panel */}
          <aside className="w-80 shrink-0 border-l border-slate-200 bg-white overflow-y-auto hidden xl:flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
                ניתוח שורות
              </div>
              <div className="text-xs text-slate-500">
                לחץ על שורה כדי להבליט אותה בשני המסמכים.
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
              {lines.map((line, i) => {
                const key = lineKey(line, i);
                const accent = statusAccent(line.status);
                const isFocus = focusKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFocusKey(isFocus ? null : key)}
                    className={`w-full text-right rounded-xl border px-3 py-2.5 transition-all ${
                      isFocus
                        ? `${accent.borderStrong} ${accent.bgStrong} ring-2 ring-offset-1 ${accent.ring}`
                        : `border-slate-200 bg-white hover:bg-slate-50`
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {line.productName}
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${accent.tint}`}
                      >
                        {accent.icon}
                        <span>{accent.label}</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[11px]">
                      <DiffCell
                        label="הזמנה"
                        qty={line.poQty}
                        price={line.poUnitPrice}
                        unit={line.unit}
                      />
                      <DiffCell
                        label="חשבונית"
                        qty={line.invoiceQty}
                        price={line.invoiceUnitPrice}
                        unit={line.unit}
                        emphasize={line.status !== 'matched'}
                      />
                    </div>
                    {line.variance > 0 ? (
                      <div className="mt-1.5 flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">הפסד פוטנציאלי</span>
                        <span className="font-bold text-red-600 tabular-nums">
                          ₪{line.variance.toFixed(2)}
                        </span>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Footer summary */}
            <div className="border-t border-slate-200 px-5 py-4 bg-slate-50/60 space-y-2">
              <SummaryRow label="סה״כ הוזמן" value={stats.totalPoIls} tone="slate" />
              <SummaryRow label="סה״כ חויב" value={stats.totalInvoiceIls} tone="slate" />
              <div className="border-t border-slate-200 pt-2 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-700">פער כללי</span>
                <span
                  className={`text-sm font-bold tabular-nums ${
                    stats.delta > 0 ? 'text-red-600' : stats.delta < 0 ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  {stats.delta > 0 ? '+' : ''}₪{Math.abs(stats.delta).toFixed(2)}
                </span>
              </div>
              {issueLines.length > 0 ? (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>
                    {issueLines.length} שורות לבדיקה. הצוות עדכן {stats.adjustedCount} מהן.
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                  <Check className="w-3 h-3" strokeWidth={3} />
                  <span>כל השורות תאמו 1:1</span>
                </div>
              )}
            </div>
          </aside>

          {/* Papers canvas */}
          <div
            className="flex-1 overflow-auto bg-gradient-to-br from-slate-100 via-slate-100/80 to-slate-200/60 p-4 sm:p-8"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          >
            <div
              className="mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 transition-transform duration-200"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
                width: 'fit-content',
              }}
            >
              {/* PO paper - right side in RTL flow (came first) */}
              <div className="order-1">
                <PaperLabel
                  icon={<ClipboardList className="w-4 h-4" />}
                  label="ההזמנה שיצאה מהמסעדה"
                  sub={`${data.poNumber} · נשלחה ${formatDate(data.poIssuedAt)}`}
                  tone="blue"
                />
                <PoPaper data={data} lines={lines} focusKey={focusKey} />
              </div>

              {/* Invoice paper - left side in RTL flow (came second).
                  Loaded via iframe from /scans/[invoiceId] so the document
                  is fetched from the database/storage URL rather than
                  rendered inline. The focusKey-based ring highlight is
                  not available across the iframe boundary; sidebar focus
                  still drives the PO side. */}
              <div className="order-2">
                <PaperLabel
                  icon={<FileText className="w-4 h-4" />}
                  label="החשבונית שהגיעה מהספק"
                  sub={`${data.invoiceNumber} · נסרקה ${formatDate(data.invoiceDate)}`}
                  tone="amber"
                />
                <div
                  className="bg-slate-200 rounded-md shadow-[0_16px_44px_-16px_rgba(15,23,42,0.28)] overflow-hidden"
                  style={{ width: 540, height: 760 }}
                >
                  <iframe
                    key={data.rawImageUrl}
                    src={data.rawImageUrl}
                    title={`סריקת חשבונית ${data.invoiceNumber}`}
                    className="w-full h-full border-0"
                    style={{
                      transform: 'scale(0.75)',
                      transformOrigin: 'top center',
                      width: '720px',
                      height: '1020px',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PO Paper (clean, digital, restaurant-issued)
// ---------------------------------------------------------------------------

function PoPaper({
  data,
  lines,
  focusKey,
}: {
  data: CompareData;
  lines: CompareLine[];
  focusKey: LineKey | null;
}) {
  const poLines = lines
    .map((l, i) => ({ ...l, idx: i }))
    .filter((l) => l.poQty !== null);
  const subtotal = poLines.reduce(
    (s, l) => s + (l.poQty ?? 0) * (l.poUnitPrice ?? 0),
    0,
  );
  const vat = subtotal * 0.17;
  const total = subtotal + vat;

  return (
    <div
      className="relative bg-white shadow-[0_12px_36px_-12px_rgba(15,23,42,0.18),0_2px_8px_rgba(15,23,42,0.06)] rounded-md"
      style={{
        width: 540,
        minHeight: 760,
        fontFamily: '"Heebo", system-ui, sans-serif',
      }}
    >
      {/* Restaurant header band */}
      <div className="rounded-t-md bg-gradient-to-l from-slate-900 to-blue-900 px-6 py-4 flex items-center justify-between text-white">
        <div>
          <div className="text-xl font-extrabold tracking-tight">{data.customerName}</div>
          <div className="text-[11px] opacity-80 mt-0.5">
            ח.פ. {data.customerBusinessId} · רחוב סוקולוב 24, רמת השרון
          </div>
        </div>
        <div className="w-12 h-12 rounded-lg bg-white/15 border border-white/25 flex items-center justify-center font-bold">
          ש.ז.
        </div>
      </div>

      <div className="px-6 pt-5 pb-8 text-slate-900">
        {/* Title row */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">הזמנת רכש</h2>
          <div className="text-left text-xs space-y-0.5">
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-slate-500">מס׳ הזמנה:</span>
              <span className="font-mono font-bold tabular-nums">{data.poNumber}</span>
            </div>
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-slate-500">נשלחה:</span>
              <span className="tabular-nums">{formatDate(data.poIssuedAt)}</span>
            </div>
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-slate-500">מועד אספקה צפוי:</span>
              <span className="tabular-nums font-medium">{formatDate(data.poExpectedAt)}</span>
            </div>
          </div>
        </div>

        {/* Supplier block */}
        <div className="bg-slate-50 rounded-lg px-4 py-2.5 mb-5 border border-slate-200/70 text-xs">
          <div className="uppercase tracking-wider text-slate-500 font-semibold mb-1 text-[10px]">
            לכבוד
          </div>
          <div className="font-bold text-sm">{data.supplierName}</div>
          <div className="text-slate-500 mt-0.5">ח.פ. {data.supplierBusinessId}</div>
        </div>

        {/* Lines */}
        <div className="overflow-hidden border border-slate-200 rounded-lg mb-5">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-100/70 text-slate-700">
                <th className="px-2 py-2 text-right font-semibold text-[10px] uppercase tracking-wider w-8">
                  #
                </th>
                <th className="px-2 py-2 text-right font-semibold text-[10px] uppercase tracking-wider">
                  פריט
                </th>
                <th className="px-2 py-2 text-right font-semibold text-[10px] uppercase tracking-wider tabular-nums">
                  כמות
                </th>
                <th className="px-2 py-2 text-right font-semibold text-[10px] uppercase tracking-wider tabular-nums">
                  מחיר
                </th>
                <th className="px-2 py-2 text-right font-semibold text-[10px] uppercase tracking-wider tabular-nums">
                  סה״כ
                </th>
              </tr>
            </thead>
            <tbody>
              {poLines.map((line) => {
                const key = lineKey(line, line.idx);
                const focused = focusKey === key;
                const accent = statusAccent(line.status);
                const lineTotal = (line.poQty ?? 0) * (line.poUnitPrice ?? 0);
                return (
                  <tr
                    key={key}
                    className={`border-t border-slate-100 transition-all ${
                      focused
                        ? `${accent.bgStrong} ring-2 ring-inset ${accent.ring}`
                        : line.idx % 2 === 0
                          ? 'bg-white'
                          : 'bg-slate-50/40'
                    }`}
                  >
                    <td className="px-2 py-2 text-slate-500 tabular-nums">{line.idx + 1}</td>
                    <td className="px-2 py-2 font-medium">{line.productName}</td>
                    <td className="px-2 py-2 tabular-nums">
                      <DiffMark on={line.status === 'qty_short' || line.status === 'qty_over'} tone="amber">
                        {line.poQty} {line.unit}
                      </DiffMark>
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      <DiffMark
                        on={line.status === 'price_higher' || line.status === 'price_lower'}
                        tone={line.status === 'price_lower' ? 'emerald' : 'red'}
                      >
                        ₪{line.poUnitPrice?.toFixed(2)}
                      </DiffMark>
                    </td>
                    <td className="px-2 py-2 tabular-nums font-semibold">
                      ₪{lineTotal.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-start">
          <div className="w-56 space-y-1 text-xs">
            <PaperTotalRow label="סכום ביניים" value={subtotal} />
            <PaperTotalRow label="מע״מ 17%" value={vat} />
            <div className="border-t-2 border-slate-300 my-1" />
            <div className="flex items-baseline justify-between bg-blue-900 text-white px-3 py-2 rounded-md">
              <span className="text-[10px] uppercase tracking-wider opacity-80">סה״כ הזמנה</span>
              <span className="font-bold tabular-nums">
                ₪{total.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 border-t border-dashed border-slate-300 pt-3 text-[11px] text-slate-500 flex items-end justify-between">
          <div>
            <div>אושר ע״י: {data.poApprovedBy}</div>
            <div className="mt-0.5">תנאי תשלום: שוטף +30</div>
          </div>
          <div
            className="px-3 py-1.5 rounded border-2 border-blue-700 text-blue-700 font-bold text-xs"
            style={{ transform: 'rotate(-3deg)' }}
          >
            ✓ נשלח בדוא״ל
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function DiffMark({
  children,
  on,
  tone,
}: {
  children: React.ReactNode;
  on: boolean;
  tone: 'red' | 'amber' | 'emerald';
}) {
  if (!on) return <>{children}</>;
  const map = {
    red: 'bg-red-100/80 text-red-700 ring-1 ring-red-300',
    amber: 'bg-amber-100/80 text-amber-800 ring-1 ring-amber-300',
    emerald: 'bg-emerald-100/80 text-emerald-700 ring-1 ring-emerald-300',
  };
  return <span className={`inline-block px-1 rounded font-semibold ${map[tone]}`}>{children}</span>;
}

function PaperLabel({
  icon,
  label,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  tone: 'blue' | 'amber';
}) {
  const map = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
  };
  return (
    <div className="flex items-center gap-2 mb-3 w-fit mx-auto">
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${map[tone]}`}
      >
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-[11px] text-slate-500">{sub}</span>
    </div>
  );
}

function PaperTotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium tabular-nums">
        ₪{value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function DiffCell({
  label,
  qty,
  price,
  unit,
  emphasize,
}: {
  label: string;
  qty: number | null;
  price: number | null;
  unit: string;
  emphasize?: boolean;
}) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ${emphasize ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50 border border-slate-100'}`}>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </div>
      {qty !== null ? (
        <div className="font-bold tabular-nums text-slate-900">
          {qty} <span className="text-[10px] font-normal text-slate-500">{unit}</span>
        </div>
      ) : (
        <div className="text-slate-400 italic text-xs">חסר</div>
      )}
      {price !== null && qty !== null ? (
        <div className="text-[9px] text-slate-500 tabular-nums">× ₪{price.toFixed(2)}</div>
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'red' | 'emerald';
}) {
  const cls = tone === 'red' ? 'text-red-600' : tone === 'emerald' ? 'text-emerald-700' : 'text-slate-700';
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${cls}`}>
        ₪{value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function DiffStatBadge({
  stats,
}: {
  stats: ReturnType<typeof computeStats>;
}) {
  if (stats.issueCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <Check className="w-3 h-3" strokeWidth={3} />
        תאמו 1:1
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
      <AlertTriangle className="w-3 h-3" />
      {stats.issueCount} חריגות
      {stats.delta !== 0 ? (
        <span className={stats.delta > 0 ? 'text-red-700' : 'text-emerald-700'}>
          · {stats.delta > 0 ? '+' : ''}₪{Math.abs(stats.delta).toFixed(0)}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status accents + helpers
// ---------------------------------------------------------------------------

function statusAccent(status: CompareLine['status']) {
  switch (status) {
    case 'qty_short':
      return {
        label: 'התקבל פחות',
        tint: 'bg-amber-50 text-amber-700 border-amber-200',
        ring: 'ring-amber-400',
        borderStrong: 'border-amber-300',
        bgStrong: 'bg-amber-50/80',
        icon: <ArrowDown className="w-2.5 h-2.5" strokeWidth={3} />,
      };
    case 'qty_over':
      return {
        label: 'התקבל יותר',
        tint: 'bg-amber-50 text-amber-700 border-amber-200',
        ring: 'ring-amber-400',
        borderStrong: 'border-amber-300',
        bgStrong: 'bg-amber-50/80',
        icon: <ArrowUp className="w-2.5 h-2.5" strokeWidth={3} />,
      };
    case 'price_higher':
      return {
        label: 'מחיר עלה',
        tint: 'bg-red-50 text-red-700 border-red-200',
        ring: 'ring-red-400',
        borderStrong: 'border-red-300',
        bgStrong: 'bg-red-50/80',
        icon: <ArrowUp className="w-2.5 h-2.5" strokeWidth={3} />,
      };
    case 'price_lower':
      return {
        label: 'מחיר ירד',
        tint: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        ring: 'ring-emerald-400',
        borderStrong: 'border-emerald-300',
        bgStrong: 'bg-emerald-50/80',
        icon: <ArrowDown className="w-2.5 h-2.5" strokeWidth={3} />,
      };
    case 'unordered':
      return {
        label: 'לא הוזמן',
        tint: 'bg-red-50 text-red-700 border-red-200',
        ring: 'ring-red-400',
        borderStrong: 'border-red-300',
        bgStrong: 'bg-red-50/80',
        icon: <Sparkles className="w-2.5 h-2.5" />,
      };
    case 'missing_from_invoice':
      return {
        label: 'חסר בחשבונית',
        tint: 'bg-slate-50 text-slate-700 border-slate-200',
        ring: 'ring-slate-400',
        borderStrong: 'border-slate-300',
        bgStrong: 'bg-slate-100/80',
        icon: <X className="w-2.5 h-2.5" strokeWidth={3} />,
      };
    default:
      return {
        label: 'תואם',
        tint: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        ring: 'ring-emerald-400',
        borderStrong: 'border-emerald-300',
        bgStrong: 'bg-emerald-50/80',
        icon: <Check className="w-2.5 h-2.5" strokeWidth={3} />,
      };
  }
}

function computeStats(lines: CompareLine[]) {
  let totalPoIls = 0;
  let totalInvoiceIls = 0;
  let issueCount = 0;
  let adjustedCount = 0;

  for (const line of lines) {
    if (line.poQty !== null && line.poUnitPrice !== null) {
      totalPoIls += line.poQty * line.poUnitPrice;
    }
    if (line.invoiceQty !== null && line.invoiceUnitPrice !== null) {
      totalInvoiceIls += line.invoiceQty * line.invoiceUnitPrice;
    }
    if (line.status !== 'matched') {
      issueCount += 1;
      if (line.variance > 0) adjustedCount += 1;
    }
  }

  return {
    totalPoIls,
    totalInvoiceIls,
    delta: totalInvoiceIls - totalPoIls,
    issueCount,
    adjustedCount,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
