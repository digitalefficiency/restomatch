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
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 sm:p-8"
      dir="rtl"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-line rounded-3xl shadow-card max-w-6xl w-full max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Viewer toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line bg-surface-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-ink truncate">
                  סריקת חשבונית {data.invoiceNumber}
                </span>
                <ConfidenceBadge value={data.ocrConfidence} />
              </div>
              <div className="text-xs text-muted flex items-center gap-2 flex-wrap">
                <Camera className="w-3 h-3" />
                <span>{data.capturedBy ?? 'נסרק מטלפון'}</span>
                <span className="text-subtle">·</span>
                <span className="font-mono tabular-nums">{dateText}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
              className="w-8 h-8 rounded-lg bg-surface border border-line hover:border-primary/40 flex items-center justify-center"
              title="הקטן"
            >
              <ZoomOut className="w-4 h-4 text-muted" />
            </button>
            <span className="text-xs font-mono tabular-nums text-muted w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}
              className="w-8 h-8 rounded-lg bg-surface border border-line hover:border-primary/40 flex items-center justify-center"
              title="הגדל"
            >
              <ZoomIn className="w-4 h-4 text-muted" />
            </button>
            <div className="w-px h-6 bg-line mx-1" />
            <a
              href={data.rawImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-surface border border-line hover:border-primary/40 hover:text-primary text-xs font-medium text-ink"
              title="פתח את הסריקה בטאב חדש"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              פתח בנפרד
            </a>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-surface border border-line hover:border-primary/40 hover:text-primary text-xs font-medium text-ink"
              title="הורד את הסריקה המקורית"
            >
              <Download className="w-3.5 h-3.5" />
              הורד
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-surface-2 hover:bg-line flex items-center justify-center"
              title="סגור"
            >
              <X className="w-4 h-4 text-muted" />
            </button>
          </div>
        </div>

        {/* Body: scan canvas + extraction panel */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Scan canvas — iframe loads the actual document from the URL stored
              in invoices.raw_image_url (simulated via /scans/[id] page route) */}
          <div className="flex-1 relative overflow-hidden bg-bg">
            {/* URL bar — reinforces "this is loaded from storage" */}
            <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2 glass border border-line rounded-full px-3 py-1.5 pointer-events-none">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-[11px] font-mono text-muted truncate">
                {typeof window !== 'undefined' ? window.location.origin : ''}
                {data.rawImageUrl}
              </span>
              <span className="text-[10px] text-subtle mr-auto shrink-0">
                נטען מהשרת
              </span>
            </div>

            <iframe
              key={data.rawImageUrl}
              src={data.rawImageUrl}
              title={`סריקת חשבונית ${data.invoiceNumber}`}
              className="w-full h-full border-0 bg-bg"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top center',
              }}
            />
          </div>

          {/* Extraction sidebar */}
          <aside className="w-80 shrink-0 border-r border-line bg-surface overflow-y-auto hidden lg:block">
            <div className="px-5 py-4 border-b border-line">
              <div className="text-xs uppercase tracking-wider text-subtle font-semibold mb-1">
                שדות שחולצו
              </div>
              <div className="text-xs text-muted">
                ה-OCR זיהה את השדות הבאים. ביטחון כללי{' '}
                <span className="font-bold text-ink font-mono tabular-nums">
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

            <div className="border-t border-line px-5 py-4">
              <div className="text-xs uppercase tracking-wider text-subtle font-semibold mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span>שורות שחולצו ({data.lines.length})</span>
              </div>
              <ul className="space-y-2">
                {data.lines.map((line, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 text-xs px-2.5 py-2 rounded-lg bg-surface-2 border border-line"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink truncate">{line.name}</div>
                      <div className="text-[10px] text-muted font-mono tabular-nums">
                        {line.qty} {line.unit} × ₪{line.unitPrice.toFixed(2)}
                      </div>
                    </div>
                    <ConfidenceDot value={line.confidence ?? data.ocrConfidence} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-line px-5 py-4">
              <div className="rounded-xl bg-primary/8 border border-primary/25 px-3 py-2.5 text-xs text-ink flex items-start gap-2">
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" strokeWidth={3} />
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
      ? 'bg-primary/12 text-primary ring-1 ring-primary/25'
      : value >= 0.8
        ? 'bg-warn/12 text-warn ring-1 ring-warn/25'
        : 'bg-danger/12 text-danger ring-1 ring-danger/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold font-mono tabular-nums ${tone}`}
    >
      OCR {pct}%
    </span>
  );
}

function ConfidenceDot({ value }: { value: number }) {
  const tone =
    value >= 0.92 ? 'bg-primary' : value >= 0.8 ? 'bg-warn' : 'bg-danger';
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
        <span className="text-[10px] uppercase tracking-wider text-subtle font-semibold">
          {label}
        </span>
        <span className="text-[10px] font-mono tabular-nums text-subtle">
          {Math.round(confidence * 100)}%
        </span>
      </div>
      <div
        className={`text-sm ${mono ? 'font-mono tabular-nums' : ''} ${
          emphasize ? 'font-bold text-primary' : 'text-ink'
        }`}
      >
        {value}
      </div>
      <div className="mt-1 h-1 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            confidence >= 0.92
              ? 'bg-primary'
              : confidence >= 0.8
                ? 'bg-warn'
                : 'bg-danger'
          }`}
          style={{ width: `${Math.round(confidence * 100)}%` }}
        />
      </div>
    </div>
  );
}
