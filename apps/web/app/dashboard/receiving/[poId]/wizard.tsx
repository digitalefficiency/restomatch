'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FileScan, Loader2, Package, Scale } from 'lucide-react';

import { AdjustQuantities } from '@/app/showcase/receiver/_steps/AdjustQuantities';
import { Confirmed } from '@/app/showcase/receiver/_steps/Confirmed';
import { InvoiceScan } from '@/app/showcase/receiver/_steps/InvoiceScan';
import { Reconciliation } from '@/app/showcase/receiver/_steps/Reconciliation';
import { StepHeader } from '@/app/showcase/receiver/_steps/SupplierSelect';
import type { ReconciliationResult } from '@/app/showcase/receiver/_mock';
import {
  lineKey,
  type CapturedImage,
  type LineMark,
} from '@/app/showcase/receiver/_state';
import { trpc } from '@/lib/trpc/client';
import {
  adaptReconciliation,
  type PoLineRow,
} from './_adapters';

interface PoForClient {
  id: string;
  supplierId: string;
  supplierName: string;
  expectedAt: string | null;
  status: string;
  totalEstimated: number | null;
  lines: PoLineRow[];
}

// Authenticated flow skips the SELECT_SUPPLIER step (supplier comes from the PO).
type Step =
  | 'SCAN_INVOICE'
  | 'PROCESSING'
  | 'RECONCILIATION_REVIEW'
  | 'ADJUST_QUANTITIES'
  | 'CONFIRMED';

const STEP_ORDER: Step[] = [
  'SCAN_INVOICE',
  'PROCESSING',
  'RECONCILIATION_REVIEW',
  'ADJUST_QUANTITIES',
  'CONFIRMED',
];

export function ReceivingWizard({
  po,
  restaurantId,
}: {
  po: PoForClient;
  restaurantId: string | null;
}) {
  const [step, setStep] = useState<Step>('SCAN_INVOICE');
  const [grId, setGrId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [marks, setMarks] = useState<Record<string, LineMark>>({});
  const [grLineIdByKey, setGrLineIdByKey] = useState<Record<string, string>>({});
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const startReceipt = trpc.receiving.startReceipt.useMutation();
  const registerInvoice = trpc.receiving.registerInvoice.useMutation();
  const markGrLine = trpc.receiving.markGrLine.useMutation();
  const submitReceipt = trpc.receiving.submitReceipt.useMutation();

  const stepIndex = STEP_ORDER.indexOf(step);

  // Eagerly ensure a goods_receipt exists (idempotent) so we have grLineIds the
  // moment the user finishes scanning. Runs once on mount.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const r = await startReceipt.mutateAsync({ poId: po.id });
        setGrId(r.receiptId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** After capture: register the invoice for OCR, then poll until parsed. */
  const onCapture = useCallback(
    async (captured: CapturedImage) => {
      setImage(captured);
      setStep('PROCESSING');
      setError(null);

      // Without an uploaded public URL we cannot register/OCR — fall back to a
      // PO-only projection so the receiver can still record quantities.
      if (!captured.publicUrl) {
        await buildFromPoOnly();
        return;
      }

      try {
        let activeGrId = grId;
        if (!activeGrId) {
          const r = await startReceipt.mutateAsync({ poId: po.id });
          activeGrId = r.receiptId;
          setGrId(activeGrId);
        }

        const reg = await registerInvoice.mutateAsync({
          grId: activeGrId,
          imageUrl: captured.publicUrl,
          supplierId: po.supplierId,
        });
        setInvoiceId(reg.invoiceId);

        const invoice = await pollInvoice(reg.invoiceId);
        await buildReconciliation(activeGrId, invoice);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        // Degrade gracefully to a PO-only table so receiving still completes.
        await buildFromPoOnly();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grId, po.id, po.supplierId],
  );

  /** Poll getInvoice until OCR leaves 'ocr_pending' (or a budget elapses). */
  async function pollInvoice(id: string) {
    const MAX_ATTEMPTS = 30; // ~30s at 1s cadence
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const inv = await utils.receiving.getInvoice.fetch({ invoiceId: id });
      if (inv.status !== 'ocr_pending') return inv;
      await new Promise((res) => setTimeout(res, 1000));
    }
    // Timed out — return the latest snapshot (may still have no lines yet).
    return utils.receiving.getInvoice.fetch({ invoiceId: id });
  }

  async function buildReconciliation(activeGrId: string, invoice: Awaited<ReturnType<typeof pollInvoice>>) {
    const receipt = await utils.receiving.getReceipt.fetch({ grId: activeGrId });
    const adapted = adaptReconciliation({
      po: {
        id: po.id,
        supplierId: po.supplierId,
        supplierName: po.supplierName,
        expectedAt: po.expectedAt,
        status: po.status,
        totalEstimated: po.totalEstimated,
      },
      poLines: po.lines,
      receiptLines: receipt.lines,
      invoiceLines: invoice.lines,
      invoiceMeta: { invoiceNumber: invoice.invoiceNumber, ocrConfidence: invoice.ocrConfidence },
    });
    setResult(adapted.result);
    setMarks(adapted.initialMarks);
    setGrLineIdByKey(adapted.grLineIdByKey);
    setStep('RECONCILIATION_REVIEW');
  }

  /** No invoice (or OCR failed): project the PO + receipt lines alone. */
  async function buildFromPoOnly() {
    try {
      let activeGrId = grId;
      if (!activeGrId) {
        const r = await startReceipt.mutateAsync({ poId: po.id });
        activeGrId = r.receiptId;
        setGrId(activeGrId);
      }
      const receipt = await utils.receiving.getReceipt.fetch({ grId: activeGrId });
      const adapted = adaptReconciliation({
        po: {
          id: po.id,
          supplierId: po.supplierId,
          supplierName: po.supplierName,
          expectedAt: po.expectedAt,
          status: po.status,
          totalEstimated: po.totalEstimated,
        },
        poLines: po.lines,
        receiptLines: receipt.lines,
        invoiceLines: [],
        invoiceMeta: null,
      });
      setResult(adapted.result);
      setMarks(adapted.initialMarks);
      setGrLineIdByKey(adapted.grLineIdByKey);
      setStep('RECONCILIATION_REVIEW');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function updateMark(key: string, patch: Partial<LineMark>) {
    setMarks((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return { ...prev, [key]: { ...existing, ...patch, touched: true } };
    });
  }

  /** Persist every touched line via markGrLine, then close the receipt. */
  async function submit() {
    if (!grId || !result) return;
    setError(null);
    try {
      // Persist marks that map to a real gr_line.
      for (const line of result.lines) {
        const key = lineKey(line);
        const grLineId = grLineIdByKey[key];
        const mark = marks[key];
        if (!grLineId || !mark) continue; // unordered arrivals have no gr_line yet
        await markGrLine.mutateAsync({
          grLineId,
          qtyReceived: mark.qtyReceived,
          qtyRejected: mark.qtyRejected,
          condition: mark.condition,
          conditionNotes: mark.notes,
          photos: image?.publicUrl ? [image.publicUrl] : undefined,
        });
      }
      await submitReceipt.mutateAsync({
        grId,
        signatureUrl: image?.publicUrl ?? undefined,
      });
      setConfirmedAt(new Date().toISOString());
      setStep('CONFIRMED');
      await utils.receiving.todayExpectations.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const submitting = markGrLine.isPending || submitReceipt.isPending;

  return (
    <main className="mx-auto max-w-3xl px-1 py-2">
      {/* Progress bar (4 work steps, CONFIRMED is the terminal state). */}
      <div className="mb-10 flex items-center gap-2" dir="rtl">
        {STEP_ORDER.slice(0, 4).map((_, i) => {
          const filled = i <= stepIndex;
          return (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all ${filled ? 'flow-stream' : 'bg-surface-2'}`}
            />
          );
        })}
      </div>

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger" dir="rtl">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {step === 'SCAN_INVOICE' ? (
        <InvoiceScan
          supplierName={po.supplierName}
          image={image}
          uploadOpts={{
            supplierName: po.supplierName,
            restaurantId: restaurantId ?? undefined,
            storagePrefix: restaurantId ?? undefined,
          }}
          onCapture={(img) => void onCapture(img)}
          onBack={() => history.back()}
        />
      ) : null}

      {step === 'PROCESSING' ? <ProcessingPoll /> : null}

      {step === 'RECONCILIATION_REVIEW' && result ? (
        <Reconciliation
          result={result}
          onQuickConfirm={() => void submit()}
          onContinueAdjust={() => setStep('ADJUST_QUANTITIES')}
          onRetake={() => {
            setImage(null);
            setResult(null);
            setStep('SCAN_INVOICE');
          }}
        />
      ) : null}

      {step === 'ADJUST_QUANTITIES' && result ? (
        <>
          <AdjustQuantities
            result={result}
            marks={marks}
            onUpdateMark={updateMark}
            onSubmit={() => void submit()}
            onBack={() => setStep('RECONCILIATION_REVIEW')}
          />
          {submitting ? (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted" dir="rtl">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              שומר את הקבלה…
            </div>
          ) : null}
        </>
      ) : null}

      {step === 'CONFIRMED' ? (
        <Confirmed
          supplierName={po.supplierName}
          result={result}
          confirmedAt={confirmedAt}
          capturedImage={image}
          onReset={() => {
            // Closed receipts are immutable here — send the receiver back to the list.
            window.location.href = '/dashboard/receiving';
          }}
        />
      ) : null}
    </main>
  );
}

/**
 * Real-OCR "processing" view. Mirrors the showcase Processing visuals but the
 * actual progress is driven by the wizard's invoice polling (not a mock timer),
 * so this component is purely presentational — no onComplete / no fake delays.
 * We do NOT mutate the shared showcase Processing.tsx; this is a local twin.
 */
const PROC_STEPS = [
  { id: 'ocr', label: 'קורא את החשבונית', icon: FileScan },
  { id: 'catalog', label: 'מזהה מוצרים בקטלוג', icon: Package },
  { id: 'compare', label: 'משווה להזמנה', icon: Scale },
] as const;

function ProcessingPoll() {
  // Cycle the active indicator while the wizard polls getInvoice in the
  // background; the wizard flips the step once OCR resolves.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % PROC_STEPS.length), 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div dir="rtl" className="mx-auto max-w-md py-6">
      <StepHeader
        eyebrow="עיבוד"
        title="מעבד את החשבונית…"
        subtitle="קוראים את החשבונית ומצליבים אותה מול ההזמנה. זה לוקח כמה שניות."
      />
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
        <div className="space-y-4">
          {PROC_STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = idx === active;
            const isDone = idx < active;
            return (
              <div
                key={s.id}
                className={`flex items-center gap-4 rounded-xl p-3 transition-all ${
                  isActive ? 'border border-primary/25 bg-primary/8' : 'bg-transparent'
                }`}
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
                    isDone || isActive
                      ? 'bg-primary/12 text-primary ring-1 ring-primary/25'
                      : 'bg-surface-2 text-subtle ring-1 ring-line'
                  }`}
                >
                  {isDone ? (
                    <Check className="h-5 w-5" strokeWidth={3} />
                  ) : isActive ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1">
                  <div className={isActive || isDone ? 'font-medium text-ink' : 'font-medium text-subtle'}>
                    {s.label}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {isDone ? 'הסתיים' : isActive ? 'מתבצע…' : 'ממתין'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
