'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  Camera,
  Check,
  Download,
  ExternalLink,
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
  /** Brand colour — used for the supplier's logotype across the top. */
  supplierColor: string;
  /** Supplier street address (one line). Matches the printed letterhead. */
  supplierAddress?: string;
  /** Phone / fax line for the supplier letterhead. */
  supplierPhone?: string;
  /**
   * Document type. Produce / fish / bakery suppliers usually issue
   * "תעודת משלוח" (delivery note) — the receiver signs it on arrival;
   * meat / liquor often jump straight to "חשבונית מס" (tax invoice).
   */
  documentType?: 'delivery_note' | 'tax_invoice';
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerBusinessId: string;
  /** Customer's accounts-receivable balance, printed bottom-right. */
  customerBalanceIls?: number;
  lines: ScanLine[];
  /** Overall OCR confidence 0..1. */
  ocrConfidence: number;
  /** Optional camera/source label shown in viewer header. */
  capturedBy?: string;
  /** Optional notes scrawled on the scan (e.g. driver signature). */
  driverSignature?: string;
  /**
   * URL of the original scan as stored in the database / object storage.
   * The viewer loads this via <iframe> so the rendered document is fetched
   * from the server, mirroring production where it would be a JPG/PDF
   * served from S3.
   */
  rawImageUrl: string;
}

interface Props {
  data: ScanData;
  onClose: () => void;
}

export function InvoiceScanViewer({ data, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
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
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(1.6, z + 0.1));
      if (e.key === '-') setZoom((z) => Math.max(0.6, z - 0.1));
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
            <a
              href={data.rawImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-700"
              title="פתח את הסריקה בטאב חדש"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              פתח בנפרד
            </a>
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
          {/* Scan canvas — iframe loads the actual document from the URL stored
              in invoices.raw_image_url (simulated via /scans/[id] page route) */}
          <div className="flex-1 relative overflow-hidden bg-slate-200">
            {/* URL bar — reinforces "this is loaded from storage" */}
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2 bg-white/95 border border-slate-200 rounded-full px-3 py-1.5 shadow-sm pointer-events-none">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-mono text-slate-600 truncate">
                {typeof window !== 'undefined' ? window.location.origin : ''}
                {data.rawImageUrl}
              </span>
              <span className="text-[10px] text-slate-400 mr-auto shrink-0">
                נטען מהשרת
              </span>
            </div>

            <iframe
              key={data.rawImageUrl}
              src={data.rawImageUrl}
              title={`סריקת חשבונית ${data.invoiceNumber}`}
              className="w-full h-full border-0 bg-slate-200"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
              }}
            />
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
