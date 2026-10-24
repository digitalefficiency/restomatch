'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, FileScan, Info, Loader2, Package, RefreshCw, Scale } from 'lucide-react';

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
import { useDockPriceLineExtra } from './dock-price-context';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { receiving } from '@/lib/i18n/messages/receiving';
import type { Translator } from '@/lib/i18n/translate';
import type { UploadedScan } from '@/lib/supabase/client';
import {
  adaptReconciliation,
  keepAdjusted,
  type PoLineRow,
} from './_adapters';
import { receivingErrorText as errorText } from './_errors';
import { pollInvoiceUntilRead } from './_poll';

/** How long to keep checking in the background after the receiver moved on. */
const BACKGROUND_POLL_MS = 10 * 60_000;
/** After this long on the processing screen, offer "continue with the order". */
const STILL_READING_AFTER_MS = 30_000;

/** Why the review was built without (fresh) invoice lines. */
type OcrNotice = null | 'reading' | 'failed' | 'quota' | 'ready';

/** Encode a File to base64 (chunked to avoid call-stack limits on large files). */
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface PoForClient {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierNameEn?: string | null;
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
  dockPriceContext = false,
}: {
  po: PoForClient;
  restaurantId: string | null;
  /** Flag `dockPriceContext` (resolved on the server page). */
  dockPriceContext?: boolean;
}) {
  const [step, setStep] = useState<Step>('SCAN_INVOICE');
  const [grId, setGrId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [ocrNotice, setOcrNotice] = useState<OcrNotice>(null);
  /** The scanned number is already on another invoice of this supplier. */
  const [duplicateNumber, setDuplicateNumber] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  /** Bumped on retake / skip / unmount — cancels any in-flight poll. */
  const pollTokenRef = useRef(0);
  const skipWaitRef = useRef(false);
  const submittingRef = useRef(false);
  /** Lines the receiver adjusted by hand — kept when the review is rebuilt
   *  ("Show results" after a slow OCR read), never reset to the invoice. */
  const adjustedKeysRef = useRef(new Set<string>());
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [marks, setMarks] = useState<Record<string, LineMark>>({});
  const [grLineIdByKey, setGrLineIdByKey] = useState<Record<string, string>>({});
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poLines, setPoLines] = useState<PoLineRow[]>(po.lines);
  const t = useT(receiving);
  const locale = useLocale();
  const dir = useDir();
  const supplierLabel = locale === 'en' && po.supplierNameEn ? po.supplierNameEn : po.supplierName;
  const capturingRef = useRef(false);

  const dockPriceLineExtra = useDockPriceLineExtra(dockPriceContext && step === 'RECONCILIATION_REVIEW', invoiceId);
  const utils = trpc.useUtils();
  const startReceipt = trpc.receiving.startReceipt.useMutation();
  const registerInvoice = trpc.receiving.registerInvoice.useMutation();
  const markGrLine = trpc.receiving.markGrLine.useMutation();
  const submitReceipt = trpc.receiving.submitReceipt.useMutation();
  // networkMode 'always': React Query's default ('online') PAUSES a mutation
  // while the device is offline — the receiver saw "Uploading…" spin forever.
  // Fail fast instead so the network message (and Retake) shows.
  const uploadScan = trpc.scans.upload.useMutation({ networkMode: 'always' });
  const ensureEnglish = trpc.receiving.ensureEnglish.useMutation();

  /**
   * Receiver in English: make sure the PO (and invoice) lines + products have
   * English names, then refresh the PO lines. Display-only and best-effort — a
   * failure just leaves Hebrew on screen.
   */
  async function ensureEnglishFor(scope: { invoiceId?: string }) {
    if (locale !== 'en') return;
    try {
      const r = await ensureEnglish.mutateAsync({ poId: po.id, ...scope });
      if (r.poLinesFilled > 0 || r.productsFilled > 0) {
        const fresh = await utils.receiving.getPo.fetch({ poId: po.id });
        setPoLines(
          fresh.lines.map((l) => ({
            id: l.id,
            productId: l.productId ?? null,
            rawDescription: l.rawDescription ?? null,
            rawDescriptionEn: l.rawDescriptionEn ?? null,
            productNameEn: l.productNameEn ?? null,
            qtyOrdered: Number(l.qtyOrdered),
            unit: l.unit,
            unitPriceExpected: l.unitPriceExpected != null ? Number(l.unitPriceExpected) : null,
          })),
        );
      }
    } catch {
      /* best effort */
    }
  }

  /**
   * Authenticated upload path (A.3): the file is uploaded by the SERVER
   * (scans.upload), which derives the tenant + storage path from the session.
   * The browser sends only bytes — never a restaurant id or a storage prefix.
   */
  const authedUpload = useCallback(
    async (file: File, clientUploadId: string): Promise<UploadedScan> => {
      const contentBase64 = await fileToBase64(file);
      const r = await uploadScan.mutateAsync({
        contentBase64,
        mimeType: file.type || 'application/octet-stream',
        supplierName: po.supplierName,
        clientUploadId,
      });
      return {
        invoiceId: r.invoiceId,
        // Short-lived signed URL for the immediate OCR/register step.
        publicUrl: r.signedUrl ?? r.scanRouteUrl,
        scanRouteUrl: r.scanRouteUrl,
        storagePath: r.storagePath,
        mimeType: r.mimeType,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [po.supplierName],
  );

  const stepIndex = STEP_ORDER.indexOf(step);

  // The goods receipt is created on the receiver's first real action (capture,
  // or the PO-only fallback) — not on page view, which used to create a
  // receipt (and its audit trail) for anyone who merely opened the PO.

  /** After capture: register the invoice for OCR, then poll until parsed. */
  const onCapture = useCallback(
    async (captured: CapturedImage) => {
      // M8: ignore a second tap while the first registration is in flight.
      if (capturingRef.current) return;
      capturingRef.current = true;
      setImage(captured);
      setStep('PROCESSING');
      setError(null);

      // Without an uploaded public URL we cannot register/OCR — fall back to a
      // PO-only projection so the receiver can still record quantities.
      if (!captured.publicUrl) {
        await buildFromPoOnly(grId);
        capturingRef.current = false;
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

        // Redis/worker unreachable: the invoice is saved but OCR was not queued —
        // say so and receive against the order instead of polling.
        if ('ocrQueued' in reg && reg.ocrQueued === false) {
          setError(t('errors.queueUnavailable'));
          await buildFromPoOnly(activeGrId);
          return;
        }

        const token = ++pollTokenRef.current;
        skipWaitRef.current = false;
        setElapsedMs(0);
        const { outcome, invoice } = await pollInvoiceUntilRead({
          fetch: () => utils.receiving.getInvoice.fetch({ invoiceId: reg.invoiceId }),
          onTick: setElapsedMs,
          isCancelled: () => pollTokenRef.current !== token || skipWaitRef.current,
        });
        if (pollTokenRef.current !== token) return; // retaken meanwhile
        if (outcome === 'ready' && invoice) {
          await showInvoice(activeGrId, reg.invoiceId);
        } else if (outcome === 'failed') {
          setOcrNotice(invoice?.ocrFailureReason === 'quota_exceeded' ? 'quota' : 'failed');
          await buildFromPoOnly(activeGrId);
        } else {
          // Timed out (or the receiver chose not to wait): receive against the
          // order now, keep checking quietly, and offer the result when ready.
          setOcrNotice('reading');
          await buildFromPoOnly(activeGrId);
          watchInBackground(activeGrId, reg.invoiceId, token).catch(() => {
            // Background check only — the Refresh button stays available.
          });
        }
      } catch (err) {
        setError(errorText(err, t, locale));
        // Degrade gracefully to a PO-only table so receiving still completes.
        await buildFromPoOnly(grId);
      } finally {
        capturingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grId, po.id, po.supplierId, locale],
  );

  /** OCR finished: (English names if needed) → build the review from it. */
  async function showInvoice(activeGrId: string, id: string) {
    if (locale === 'en') await ensureEnglishFor({ invoiceId: id });
    const invoice = await utils.receiving.getInvoice.fetch({ invoiceId: id });
    setOcrNotice(null);
    setError(null);
    await buildReconciliation(activeGrId, invoice);
  }

  /** Keep checking after the receiver moved on; flag the result when it lands. */
  async function watchInBackground(activeGrId: string, id: string, token: number) {
    const { outcome, invoice } = await pollInvoiceUntilRead({
      fetch: () => utils.receiving.getInvoice.fetch({ invoiceId: id }),
      maxMs: BACKGROUND_POLL_MS,
      isCancelled: () => pollTokenRef.current !== token,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(ms, 5_000))),
    });
    if (pollTokenRef.current !== token || submittingRef.current) return;
    if (outcome === 'ready') setOcrNotice('ready');
    else if (outcome === 'failed') setOcrNotice(invoice?.ocrFailureReason === 'quota_exceeded' ? 'quota' : 'failed');
  }

  /** Manual refresh from the review screen ("still reading" / "ready" banner). */
  async function refreshInvoice() {
    if (!invoiceId || !grId || submittingRef.current) return;
    const token = pollTokenRef.current;
    try {
      const inv = await utils.receiving.getInvoice.fetch({ invoiceId });
      // Closed, retaken or unmounted while the request was in flight.
      if (pollTokenRef.current !== token || submittingRef.current) return;
      if (inv.ocrFailed) setOcrNotice(inv.ocrFailureReason === 'quota_exceeded' ? 'quota' : 'failed');
      else if (inv.status !== 'ocr_pending') await showInvoice(grId, invoiceId);
    } catch (err) {
      setError(errorText(err, t, locale));
    }
  }

  // Cancel polling on unmount.
  useEffect(() => () => {
    pollTokenRef.current += 1;
  }, []);

  type InvoiceSnapshot = Awaited<ReturnType<typeof utils.receiving.getInvoice.fetch>>;
  async function buildReconciliation(activeGrId: string, invoice: InvoiceSnapshot) {
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
      poLines,
      receiptLines: receipt.lines,
      invoiceLines: invoice.lines,
      invoiceMeta: { invoiceNumber: invoice.invoiceNumber, ocrConfidence: invoice.ocrConfidence },
      labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
    });
    setResult(adapted.result);
    setDuplicateNumber(invoice.duplicateOf?.invoiceNumber ?? null);
    setMarks((prev) => keepAdjusted(prev, adapted.initialMarks, adjustedKeysRef.current));
    setGrLineIdByKey(adapted.grLineIdByKey);
    setStep('RECONCILIATION_REVIEW');
  }

  /** No invoice (or OCR failed): project the PO + receipt lines alone. */
  async function buildFromPoOnly(knownGrId: string | null) {
    try {
      let activeGrId = knownGrId ?? grId;
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
        poLines,
        receiptLines: receipt.lines,
        invoiceLines: [],
        invoiceMeta: null,
        labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
      });
      setResult(adapted.result);
      setMarks(adapted.initialMarks);
      setGrLineIdByKey(adapted.grLineIdByKey);
      setStep('RECONCILIATION_REVIEW');
    } catch (err) {
      setError(errorText(err, t, locale));
    }
  }

  function updateMark(key: string, patch: Partial<LineMark>) {
    adjustedKeysRef.current.add(key);
    setMarks((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return { ...prev, [key]: { ...existing, ...patch, touched: true } };
    });
  }

  /** Persist every touched line via markGrLine, then close the receipt. */
  async function submit() {
    if (!grId || !result) return;
    // Double-tap on "close receipt" must not submit twice.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    pollTokenRef.current += 1; // stop background OCR polling
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
      setError(errorText(err, t, locale));
    } finally {
      submittingRef.current = false;
    }
  }

  const submitting = markGrLine.isPending || submitReceipt.isPending;

  return (
    <main className="mx-auto max-w-3xl px-1 py-2">
      {/* Progress bar: the same 5 steps as the "Step N of 5" eyebrows. Step 1
          (supplier) is already done — the PO names it — so the bar is always
          one segment ahead of STEP_ORDER. */}
      <div className="mb-8 flex items-center gap-2" dir={dir} data-testid="wizard-progress" data-filled={Math.min(stepIndex + 2, 5)}>
        {[0, 1, 2, 3, 4].map((i) => {
          const filled = i <= stepIndex + 1;
          return (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-all ${filled ? 'flow-stream' : 'bg-surface-2'}`}
            />
          );
        })}
      </div>

      {error ? (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger" dir={dir}>
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {step === 'SCAN_INVOICE' ? (
        <InvoiceScan
          supplierName={supplierLabel}
          image={image}
          backLabel={t('steps.scan.back')}
          uploadFile={restaurantId ? authedUpload : undefined}
          onCapture={(img) => void onCapture(img)}
          onBack={() => history.back()}
        />
      ) : null}

      {step === 'PROCESSING' ? (
        <ProcessingPoll
          t={t}
          dir={dir}
          stillReading={elapsedMs >= STILL_READING_AFTER_MS}
          onSkip={() => {
            skipWaitRef.current = true;
          }}
        />
      ) : null}

      {ocrNotice && (step === 'RECONCILIATION_REVIEW' || step === 'ADJUST_QUANTITIES') ? (
        <OcrNoticeBanner notice={ocrNotice} t={t} dir={dir} onRefresh={() => void refreshInvoice()} />
      ) : null}

      {duplicateNumber && (step === 'RECONCILIATION_REVIEW' || step === 'ADJUST_QUANTITIES') ? (
        // Calm, not an alarm: the read is kept and goes to a human; receiving continues.
        <div
          role="status"
          data-testid="duplicate-invoice-notice"
          dir={dir}
          className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink"
        >
          <Info className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="flex-1">
            {t('steps.recon.duplicateInvoice', { number: duplicateNumber })}
          </span>
        </div>
      ) : null}

      {step === 'RECONCILIATION_REVIEW' && result ? (
        <Reconciliation
          result={result}
          lineExtra={dockPriceLineExtra}
          onQuickConfirm={() => void submit()}
          onContinueAdjust={() => setStep('ADJUST_QUANTITIES')}
          onRetake={() => {
            pollTokenRef.current += 1; // drop the old scan's pending result
            setOcrNotice(null);
            setDuplicateNumber(null);
            setInvoiceId(null);
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
            // Clear the fixed mobile bottom nav (dashboard/nav.tsx, lg:hidden).
            footerBottomClass="bottom-[calc(4.5rem+env(safe-area-inset-bottom)+var(--consent-h,0px))] lg:bottom-[var(--consent-h,0px)]"
          />
          {submitting ? (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted" dir={dir}>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('steps.adjust.saving')}
            </div>
          ) : null}
        </>
      ) : null}

      {step === 'CONFIRMED' ? (
        <Confirmed
          supplierName={supplierLabel}
          result={result}
          resetLabel={t('steps.confirmed.backToInbox')}
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
  { id: 'ocr', label: 'steps.processing.ocr', icon: FileScan },
  { id: 'catalog', label: 'steps.processing.catalog', icon: Package },
  { id: 'compare', label: 'steps.processing.compare', icon: Scale },
] as const;

/** Banner on the review screens about the invoice read (EN-3 / EN-4). Calm tone. */
function OcrNoticeBanner({
  notice,
  t,
  dir,
  onRefresh,
}: {
  notice: Exclude<OcrNotice, null>;
  t: Translator<typeof receiving.he>;
  dir: 'rtl' | 'ltr';
  onRefresh: () => void;
}) {
  const text =
    notice === 'reading'
      ? t('errors.ocrTimeout')
      : notice === 'ready'
        ? t('steps.processing.readyLater')
        : notice === 'quota'
          ? t('errors.ocrQuota')
          : t('errors.ocrFailed');
  const canRefresh = notice === 'reading' || notice === 'ready';
  return (
    <div
      role="status"
      data-testid={`ocr-notice-${notice}`}
      dir={dir}
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
        notice === 'ready' ? 'border-primary/30 bg-primary/8 text-ink' : 'border-line bg-surface-2 text-ink'
      }`}
    >
      <Info className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="flex-1">{text}</span>
      {canRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 font-medium text-ink hover:border-primary/40"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {notice === 'ready' ? t('steps.processing.showResults') : t('steps.processing.refresh')}
        </button>
      ) : null}
    </div>
  );
}

function ProcessingPoll({
  t,
  dir,
  stillReading,
  onSkip,
}: {
  t: Translator<typeof receiving.he>;
  dir: 'rtl' | 'ltr';
  stillReading: boolean;
  onSkip: () => void;
}) {
  // Cycle the active indicator while the wizard polls getInvoice in the
  // background; the wizard flips the step once OCR resolves.
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % PROC_STEPS.length), 1400);
    return () => clearInterval(t);
  }, []);

  return (
    <div dir={dir} className="mx-auto max-w-md py-6">
      <StepHeader
        eyebrow={t('steps.processing.eyebrow')}
        title={stillReading ? t('steps.processing.stillReadingTitle') : t('steps.processing.title')}
        subtitle={stillReading ? t('steps.processing.stillReading') : t('steps.processing.subtitleLive')}
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
                    {t(s.label)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {isDone
                      ? t('steps.processing.done')
                      : isActive
                        ? t('steps.processing.running')
                        : t('steps.processing.waiting')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {stillReading ? (
        <button
          type="button"
          onClick={onSkip}
          data-testid="skip-ocr-wait"
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-5 py-3 font-medium text-ink hover:border-primary/40"
        >
          {t('steps.processing.continueWithOrder')}
        </button>
      ) : null}
    </div>
  );
}
