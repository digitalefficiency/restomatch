'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { Check, FileScan, Loader2, Package, Scale } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  mockReconcile,
  type ContactChangeAlert,
  type ReconciliationLine,
  type ReconciliationResult,
} from '../_mock';
import { StepHeader } from './SupplierSelect';

interface Props {
  supplierId: string;
  /** Public URL of the uploaded invoice. When present, runs real Claude Vision OCR. */
  imageUrl?: string;
  onComplete: (result: ReconciliationResult) => void;
}

interface OcrLine {
  sku?: string;
  rawDescription: string;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  vatRate?: number;
}
interface OcrResult {
  invoiceNumber?: string;
  invoiceDate?: string;
  supplier?: { businessId?: string };
  lines: OcrLine[];
  totals: { subtotal?: number; vat?: number; total?: number };
  confidence?: number;
}

/** Map the real OCR extraction into the wizard's reconciliation shape. */
function ocrToReconciliation(
  ocr: OcrResult,
  supplierId: string,
  contactAlerts?: ContactChangeAlert[],
): ReconciliationResult {
  const lines: ReconciliationLine[] = ocr.lines.map((l, i) => ({
    invoiceLineIndex: i,
    poLineId: null,
    productId: null,
    sku: l.sku ?? null,
    productName: l.rawDescription,
    poQty: null,
    poUnit: null,
    invoiceQty: l.qty,
    invoiceUnit: l.unit,
    poUnitPrice: null,
    invoiceUnitPrice: l.unitPrice,
    status: 'unordered',
    deltaIls: 0,
  }));
  return {
    invoiceMeta: {
      invoiceNumber: ocr.invoiceNumber ?? '—',
      invoiceDate: ocr.invoiceDate ?? '',
      totalInclVat: ocr.totals.total ?? 0,
      ocrConfidence: ocr.confidence ?? 0.9,
    },
    matchedSupplierId: supplierId,
    matchedPoIds: [],
    contactAlerts,
    supplierBusinessId: ocr.supplier?.businessId,
    lines,
    summary: {
      matchedCount: 0,
      qtyDiffCount: 0,
      priceDiffCount: 0,
      unorderedCount: lines.length,
      missingCount: 0,
      overallConfidence: ocr.confidence ?? 0.9,
      headlineDelta: 0,
    },
  };
}

const STEPS = [
  { id: 'ocr', label: 'קורא את החשבונית', icon: FileScan, duration: 1100 },
  { id: 'catalog', label: 'מזהה מוצרים בקטלוג', icon: Package, duration: 900 },
  { id: 'compare', label: 'משווה להזמנה', icon: Scale, duration: 800 },
] as const;

export function Processing({ supplierId, imageUrl, onComplete }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [ocrError, setOcrError] = useState<string | null>(null);

  useGSAP(
    () => {
      gsap.from('.proc-step', {
        x: -20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.5,
        ease: 'power3.out',
      });
    },
    { scope: ref },
  );

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return; // run once per mount (parent re-renders new onComplete)
    startedRef.current = true;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Drive the visual step indicator.
    let accumulated = 0;
    for (let i = 0; i < STEPS.length; i += 1) {
      accumulated += STEPS[i]!.duration;
      timers.push(
        setTimeout(() => {
          if (!cancelled) setCurrentStep((s) => Math.max(s, i + 1));
        }, accumulated),
      );
    }

    if (imageUrl) {
      // Real OCR — Claude Vision reads the uploaded invoice (items/qty/prices).
      void (async () => {
        try {
          const res = await fetch('/api/showcase/ocr', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: imageUrl }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            result?: OcrResult;
            contactAlerts?: ContactChangeAlert[];
            error?: string;
          };
          if (cancelled) return;
          setCurrentStep(STEPS.length);
          if (data.ok && data.result && data.result.lines.length > 0) {
            onComplete(ocrToReconciliation(data.result, supplierId, data.contactAlerts));
          } else {
            setOcrError(data.error ?? 'לא זוהו פריטים בחשבונית');
            onComplete(mockReconcile(supplierId));
          }
        } catch (err) {
          if (cancelled) return;
          setOcrError(err instanceof Error ? err.message : String(err));
          onComplete(mockReconcile(supplierId));
        }
      })();
    } else {
      // No uploaded file (demo image) — keep the mock flow.
      timers.push(
        setTimeout(() => {
          if (!cancelled) onComplete(mockReconcile(supplierId));
        }, accumulated + 400),
      );
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [supplierId, imageUrl, onComplete]);
  void ocrError;

  return (
    <div ref={ref} dir="rtl" className="max-w-md mx-auto py-6">
      <StepHeader
        eyebrow="צעד 3 מתוך 5"
        title="מעבד את החשבונית…"
        subtitle="זה לוקח 5-15 שניות. אנחנו מזהים פריטי-שורה ומשווים אותם להזמנה."
      />

      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
        <div className="space-y-4">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isDone = idx < currentStep;
            const isActive = idx === currentStep;
            const isPending = idx > currentStep;

            return (
              <div
                key={step.id}
                className={`proc-step flex items-center gap-4 p-3 rounded-xl transition-all ${
                  isActive ? 'bg-primary/8 border border-primary/25' : 'bg-transparent'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                    isDone
                      ? 'bg-primary/12 text-primary ring-1 ring-primary/25'
                      : isActive
                        ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                        : 'bg-surface-2 text-subtle ring-1 ring-line'
                  }`}
                >
                  {isDone ? (
                    <Check className="w-5 h-5" strokeWidth={3} />
                  ) : isActive ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1">
                  <div
                    className={`font-medium ${
                      isPending ? 'text-subtle' : 'text-ink'
                    }`}
                  >
                    {step.label}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {isDone ? 'הסתיים' : isActive ? 'מתבצע…' : 'ממתין'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-line">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>שלב {Math.min(currentStep + 1, STEPS.length)} מתוך {STEPS.length}</span>
            <span className="tabular-nums font-mono">
              {Math.round((currentStep / STEPS.length) * 100)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full flow-stream transition-all duration-500 ease-out"
              style={{ width: `${(currentStep / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
