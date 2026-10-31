'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Camera, Check, FileScan, FileWarning, Info, Loader2, RefreshCw, Scale } from 'lucide-react';

import { AdjustQuantities, type LineSaveUi } from '@/app/showcase/receiver/_steps/AdjustQuantities';
import { Confirmed } from '@/app/showcase/receiver/_steps/Confirmed';
import { InvoiceScan } from '@/app/showcase/receiver/_steps/InvoiceScan';
import { Reconciliation } from '@/app/showcase/receiver/_steps/Reconciliation';
import { StepHeader } from '@/app/showcase/receiver/_steps/SupplierSelect';
import type { QtyTolerance } from '@/app/showcase/receiver/_steps/qtyEntry';
import type { ReconciliationResult } from '@/app/showcase/receiver/_mock';
import { lineKey, type CapturedImage, type LineMark } from '@/app/showcase/receiver/_state';
import { trpc } from '@/lib/trpc/client';
import { useDockPriceLineExtra } from './dock-price-context';
import { useAppLocale, useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatDate, formatNumber } from '@/lib/i18n/format';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import type { Translator } from '@/lib/i18n/translate';
import { isReceiverLocale } from '@/lib/i18n/config';
import type { UploadedScan } from '@/lib/supabase/client';
import { ingest } from '@/lib/i18n/messages/ingest';
import { SYNCED_EVENT, enqueuePhoto, idbAvailable, isNetworkError, type SyncedPhotoDetail } from '@/lib/pwa/offlineQueue';
import { adaptReconciliation, keepAdjusted, markFromCount, type PoLineRow, type ReceiptLineRow } from './_adapters';
import { fromGrLine } from './_count';
import { localizeInvoiceLines, localizePoLines, localizeReceiptLines, type LocalNames } from './_localize';
import { receivingErrorText as errorText } from './_errors';
import { pollInvoiceUntilRead } from './_poll';
import { buildSlipLines, lineIssues, needsSlip } from './_dockSlip';
import {
  payloadFor,
  payloadIsCounted,
  readDraft,
  useLeaveGuard,
  useLineSaves,
  useFieldBarOffset,
  useWakeLock,
  writeDraft,
  type LeaveTarget,
} from './_fieldHooks';
import { ReceiptSummary } from './receipt-summary';

// The slip is only needed once there is something to dispute: keep it out of the first load.
const DockSlip = dynamic(() => import('./dock-slip').then((m) => m.DockSlip), { ssr: false });

/** How long to keep checking in the background after the receiver moved on. */
const BACKGROUND_POLL_MS = 10 * 60_000;
/** After this long reading, offer "continue with the order" (perf-states-11, NN/g 10 s). */
export const STILL_READING_AFTER_MS = 10_000;

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
  /** Per-restaurant feature flags the wizard reads (receiving.getPo). */
  features?: { dockSlip?: boolean };
}

/** The PO's goods receipt as the page found it (receiving.getReceipt), if one exists. */
export interface ReceiptForClient {
  id: string;
  status: string;
  receivedAt: string | null;
  lines: ReceiptLineRow[];
}

// Authenticated flow skips the SELECT_SUPPLIER step (supplier comes from the PO).
type Step =
  | 'RESUMING'
  | 'SCAN_INVOICE'
  | 'PROCESSING'
  | 'RECONCILIATION_REVIEW'
  | 'ADJUST_QUANTITIES'
  | 'CONFIRMED'
  | 'SUMMARY';

const isClosed = (status: string | undefined) => status === 'completed' || status === 'partial';

export function ReceivingWizard({
  po,
  restaurantId,
  offlineQueue = false,
  userId = null,
  localNames,
  dockPriceContext = false,
  existingReceipt = null,
  tolerance,
  showMoney = false,
  receiverName = null,
}: {
  po: PoForClient;
  restaurantId: string | null;
  /** S13 receiverPwa: queue photos in IndexedDB when offline (lib/pwa/offlineQueue). */
  offlineQueue?: boolean;
  /** Owner of queued photos — they only ever upload under this user (shared tablets). */
  userId?: string | null;
  /** Receiver languages (S14): Hebrew → ar/ru/th/ti, fetched by the page. */
  localNames?: LocalNames;
  /** Flag `dockPriceContext` (resolved on the server page). */
  dockPriceContext?: boolean;
  /** This PO's receipt when the page opened (resume a count / read-only when closed). */
  existingReceipt?: ReceiptForClient | null;
  /** The matching engine's quantity tolerance (read on the server from @restomatch/matching). */
  tolerance?: QtyTolerance;
  /** Owner / manager / bookkeeper. The receiver and the chef see no ₪ (owner decision). */
  showMoney?: boolean;
  /** Who is receiving (the signed-in person) — shown on the confirmation. */
  receiverName?: string | null;
}) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const tIngest = useT(ingest);
  const locale = useLocale();
  const appLocale = useAppLocale();
  const dir = useDir();
  const router = useRouter();
  const receiverLocale = isReceiverLocale(appLocale) ? appLocale : null;
  const supplierLabel = locale === 'en' && po.supplierNameEn ? po.supplierNameEn : po.supplierName;
  const storeKey = `${userId ?? '-'}:${po.id}`;
  const draftKey = `rm-rcv-draft:${storeKey}`;

  const closedAtOpen = existingReceipt && isClosed(existingReceipt.status) ? existingReceipt : null;
  const [step, setStep] = useState<Step>(
    closedAtOpen ? 'SUMMARY' : existingReceipt ? 'RESUMING' : 'SCAN_INVOICE',
  );
  const [grId, setGrId] = useState<string | null>(existingReceipt?.id ?? null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [ocrNotice, setOcrNotice] = useState<OcrNotice>(null);
  /** The scanned number is already on another invoice of this supplier. */
  const [duplicateNumber, setDuplicateNumber] = useState<string | null>(null);
  /** Flag dockSlip: off → no slip anywhere. */
  const dockSlipOn = po.features?.dockSlip === true;
  const [showSlip, setShowSlip] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [resumed, setResumed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [footerError, setFooterError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leaveAsk, setLeaveAsk] = useState<LeaveTarget | null>(null);
  const [next, setNext] = useState<{ poId: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped on retake / skip / unmount — cancels any in-flight poll. */
  const pollTokenRef = useRef(0);
  const skipWaitRef = useRef(false);
  const submittingRef = useRef(false);
  const capturingRef = useRef(false);
  /** Lines the receiver changed by hand — kept when the review is rebuilt, never reset to the invoice. */
  const adjustedKeysRef = useRef(new Set<string>());
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [marks, setMarksState] = useState<Record<string, LineMark>>({});
  const marksRef = useRef(marks);
  const [grLineIdByKey, setGrLineIdByKeyState] = useState<Record<string, string>>({});
  const grLineIdByKeyRef = useRef(grLineIdByKey);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [poLines, setPoLines] = useState<PoLineRow[]>(po.lines);
  // Receiver languages (S14): Hebrew → ar/ru/th/ti names for this PO/invoice.
  const localNamesRef = useRef<LocalNames>(localNames ?? {});
  const localNamesMut = trpc.receiverLangs.localNames.useMutation();
  const rootRef = useRef<HTMLDivElement>(null);

  const setMarks = useCallback((next: Record<string, LineMark>) => {
    marksRef.current = next;
    setMarksState(next);
  }, []);
  const setGrLineIdByKey = useCallback((next: Record<string, string>) => {
    grLineIdByKeyRef.current = next;
    setGrLineIdByKeyState(next);
  }, []);

  const utils = trpc.useUtils();
  const registerInvoice = trpc.receiving.registerInvoice.useMutation();
  // startReceipt / submitReceipt go through the plain client: React Query would
  // PAUSE them offline (a forever spinner) instead of failing fast.
  // networkMode 'always': React Query's default ('online') PAUSES a mutation
  // while the device is offline — the receiver saw "Uploading…" spin forever.
  // Fail fast instead so the network message (and Retake) shows.
  const uploadScan = trpc.scans.upload.useMutation({ networkMode: 'always' });
  const ensureEnglish = trpc.receiving.ensureEnglish.useMutation();

  // Every mark is saved on change (300 ms, full row) and kept on the phone offline.
  const { outbox, states: saveByGrLine, pending: unsent } = useLineSaves(`rm-rcv-lines:${storeKey}`, (p) =>
    utils.client.receiving.markGrLine.mutate(p),
  );
  const saveStates = useMemo(() => {
    const out: Record<string, LineSaveUi> = {};
    for (const [key, id] of Object.entries(grLineIdByKey)) if (saveByGrLine[id]) out[key] = saveByGrLine[id];
    return out;
  }, [grLineIdByKey, saveByGrLine]);

  const counting = step === 'RECONCILIATION_REVIEW' || step === 'ADJUST_QUANTITIES';
  useFieldBarOffset(rootRef);
  useWakeLock(step !== 'CONFIRMED' && step !== 'SUMMARY');
  const { leave } = useLeaveGuard(unsent > 0 && step !== 'CONFIRMED', setLeaveAsk);

  // A step change moves focus to its heading and the page to the top (a11y-06).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    rootRef.current?.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step]);

  // Remember the receipt + invoice on this device so a reload resumes the same read.
  useEffect(() => {
    if (grId && step !== 'CONFIRMED' && step !== 'SUMMARY' && step !== 'RESUMING') {
      writeDraft(draftKey, { grId, invoiceId, savedAt: Date.now() });
    }
  }, [grId, invoiceId, step, draftKey]);

  // Is there anything to dispute? (short / rejected / over-priced / unordered / duplicate)
  const slipNeeded = useMemo(
    () => dockSlipOn && !!result && needsSlip(buildSlipLines(result.lines, marks, []), duplicateNumber),
    [dockSlipOn, result, marks, duplicateNumber],
  );
  const dockPriceLineExtra = useDockPriceLineExtra(showMoney && dockPriceContext && step === 'RECONCILIATION_REVIEW', invoiceId);

  /** Receiver languages: fetch (DB-cached) local names; best effort. */
  async function refreshLocalNames(scope: { invoiceId?: string }) {
    if (!receiverLocale) return;
    try {
      const r = await localNamesMut.mutateAsync({ locale: receiverLocale, poId: po.id, ...scope });
      localNamesRef.current = { ...localNamesRef.current, ...r.names };
    } catch {
      /* best effort — English (then Hebrew) stays on screen */
    }
  }

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
          localizePoLines(fresh.lines.map((l) => ({
            id: l.id,
            productId: l.productId ?? null,
            rawDescription: l.rawDescription ?? null,
            rawDescriptionEn: l.rawDescriptionEn ?? null,
            productNameEn: l.productNameEn ?? null,
            qtyOrdered: Number(l.qtyOrdered),
            unit: l.unit,
            unitPriceExpected: l.unitPriceExpected != null ? Number(l.unitPriceExpected) : null,
          })), localNamesRef.current),
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
      // S13 receiverPwa: offline (or the network drops mid-upload) → keep the
      // photo in IndexedDB under the SAME clientUploadId; the PWA shell uploads
      // it when back online (idempotent, M8). An empty publicUrl = queued.
      const queue = async (): Promise<UploadedScan> => {
        await enqueuePhoto({
          clientUploadId,
          restaurantId: restaurantId!,
          userId: userId!,
          poId: po.id,
          supplierId: po.supplierId,
          supplierName: po.supplierName,
          mimeType: file.type || 'image/jpeg',
          blob: file,
          // Shared tablet: a colleague may upload it later — "צולם על ידי".
          capturedByName: receiverName ?? null,
        });
        return { invoiceId: `queued-${clientUploadId}`, publicUrl: '', scanRouteUrl: '', storagePath: '', mimeType: file.type };
      };
      const canQueue = offlineQueue && Boolean(restaurantId) && Boolean(userId) && idbAvailable();
      if (canQueue && !navigator.onLine) return queue();
      const contentBase64 = await fileToBase64(file);
      let r;
      try {
        r = await uploadScan.mutateAsync({
          contentBase64,
          mimeType: file.type || 'application/octet-stream',
          supplierName: po.supplierName,
          clientUploadId,
        });
      } catch (err) {
        if (canQueue && isNetworkError(err)) return queue();
        throw err;
      }
      return {
        invoiceId: r.invoiceId,
        // Short-lived signed URL: ONLY for the immediate register/OCR step. It is
        // never persisted as evidence (RCV-08) — no gr_line photo, no signature.
        publicUrl: r.signedUrl ?? r.scanRouteUrl,
        scanRouteUrl: r.scanRouteUrl,
        storagePath: r.storagePath,
        mimeType: r.mimeType,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [po.supplierName, offlineQueue, restaurantId, userId],
  );

  /** The goods receipt (created on the receiver's first real action, never on page view). */
  async function ensureReceipt(known: string | null): Promise<string> {
    if (known) return known;
    const r = await utils.client.receiving.startReceipt.mutate({ poId: po.id });
    setGrId(r.receiptId);
    return r.receiptId;
  }

  /** After capture: register the invoice for OCR, then poll until parsed. */
  const onCapture = useCallback(
    async (captured: CapturedImage) => {
      // M8: ignore a second tap while the first registration is in flight.
      if (capturingRef.current) return;
      capturingRef.current = true;
      setImage(captured);
      setError(null);

      // Without an uploaded URL we cannot register/OCR.
      if (!captured.publicUrl) {
        // S13: photo queued offline — say so calmly (T4) and count against the
        // order meanwhile; the photo uploads by itself (mobile-field-02).
        if (offlineQueue && captured.invoiceId?.startsWith('queued-')) setNotice(tIngest('pwa.savedOffline'));
        await buildFromPoOnly(grId);
        capturingRef.current = false;
        return;
      }

      setStep('PROCESSING');
      try {
        const activeGrId = await ensureReceipt(grId);
        const reg = await registerInvoice.mutateAsync({
          grId: activeGrId,
          imageUrl: captured.publicUrl,
          supplierId: po.supplierId,
        });
        setInvoiceId(reg.invoiceId);

        // Queue database unreachable: the invoice is saved but OCR was not queued —
        // say so and receive against the order instead of polling.
        if ('ocrQueued' in reg && reg.ocrQueued === false) {
          setNotice(t('errors.queueUnavailable'));
          await buildFromPoOnly(activeGrId);
          return;
        }

        await pollAndShow(activeGrId, reg.invoiceId);
      } catch (err) {
        setError(errorText(err, t, locale));
        // Degrade gracefully to receiving against the order.
        await buildFromPoOnly(grId);
      } finally {
        capturingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grId, po.id, po.supplierId, locale, offlineQueue],
  );

  /** A registered invoice: poll until OCR read it, then the review (or the order-only count). */
  async function pollAndShow(activeGrId: string, id: string) {
    const token = ++pollTokenRef.current;
    skipWaitRef.current = false;
    setElapsedMs(0);
    const { outcome, invoice } = await pollInvoiceUntilRead({
      fetch: () => utils.receiving.getInvoice.fetch({ invoiceId: id }),
      onTick: setElapsedMs,
      isCancelled: () => pollTokenRef.current !== token || skipWaitRef.current,
    });
    if (pollTokenRef.current !== token) return; // retaken meanwhile
    if (outcome === 'ready' && invoice) {
      await showInvoice(activeGrId, id);
    } else if (outcome === 'failed') {
      setOcrNotice(invoice?.ocrFailureReason === 'quota_exceeded' ? 'quota' : 'failed');
      await buildFromPoOnly(activeGrId);
    } else {
      // Timed out (or the receiver chose not to wait): count against the order
      // now, keep checking quietly, and offer the result when ready.
      setOcrNotice('reading');
      await buildFromPoOnly(activeGrId);
      watchInBackground(id, token).catch(() => {
        // Background check only — the Refresh button stays available.
      });
    }
  }

  // S13: a photo captured offline was uploaded + registered by the PWA shell
  // (ReceiverPwa) once back online. Pick it up: the invoice is read in the
  // background while the receiver keeps counting (a Retake would have uploaded a
  // second copy of the same paper — second invoice row, second OCR charge).
  useEffect(() => {
    if (!offlineQueue) return;
    const onSynced = (e: Event) => {
      const d = (e as CustomEvent<SyncedPhotoDetail>).detail;
      if (!d || d.poId !== po.id || !image || image.invoiceId !== `queued-${d.clientUploadId}`) return;
      setImage({ ...image, invoiceId: d.invoiceId });
      setGrId(d.grId);
      setInvoiceId(d.invoiceId);
      setNotice(null);
      setOcrNotice('reading');
      const token = ++pollTokenRef.current;
      watchInBackground(d.invoiceId, token).catch(() => null);
    };
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineQueue, po.id, image]);

  /** OCR finished: (English names if needed) → build the review from it. */
  async function showInvoice(activeGrId: string, id: string, toStep: Step = 'RECONCILIATION_REVIEW') {
    if (locale === 'en') await ensureEnglishFor({ invoiceId: id });
    const invoice = await utils.receiving.getInvoice.fetch({ invoiceId: id });
    // Receiver languages (S14): local names for the invoice lines (best effort).
    await refreshLocalNames({ invoiceId: id });
    setOcrNotice(null);
    setError(null);
    await buildReconciliation(activeGrId, invoice, toStep);
  }

  /** Keep checking after the receiver moved on; flag the result when it lands. */
  async function watchInBackground(id: string, token: number) {
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

  /** Manual refresh from the count / review ("still reading" / "ready" banner). */
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

  /** Restore the marks the outbox still holds (not yet on the server) over a fresh projection. */
  function withUnsent(base: Record<string, LineMark>, idByKey: Record<string, string>): Record<string, LineMark> {
    const out = { ...base };
    const keyById = new Map(Object.entries(idByKey).map(([k, id]) => [id, k]));
    for (const p of outbox.pending()) {
      const key = keyById.get(p.grLineId);
      const m = key ? out[key] : undefined;
      if (!key || !m) continue;
      // Through the count model: a reset is "not counted", a missing line stays missing,
      // and the method (bulk / spot check / one by one) comes back with it.
      out[key] = payloadIsCounted(p)
        ? markFromCount(m, fromGrLine(p, null), m.qtyReceived, p.conditionNotes ?? null)
        : { ...m, touched: false };
      adjustedKeysRef.current.add(key);
    }
    return out;
  }

  type InvoiceSnapshot = Awaited<ReturnType<typeof utils.receiving.getInvoice.fetch>>;
  async function buildReconciliation(activeGrId: string, invoice: InvoiceSnapshot, toStep: Step = 'RECONCILIATION_REVIEW') {
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
      poLines: localizePoLines(poLines, localNamesRef.current),
      receiptLines: localizeReceiptLines(receipt.lines, localNamesRef.current),
      invoiceLines: localizeInvoiceLines(invoice.lines, localNamesRef.current),
      invoiceMeta: { invoiceNumber: invoice.invoiceNumber, ocrConfidence: invoice.ocrConfidence },
      labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
    });
    setResult(adapted.result);
    setDuplicateNumber(invoice.duplicateOf?.invoiceNumber ?? null);
    setGrLineIdByKey(adapted.grLineIdByKey);
    setMarks(withUnsent(keepAdjusted(marksRef.current, adapted.initialMarks, adjustedKeysRef.current), adapted.grLineIdByKey));
    setStep(toStep);
  }

  /** No invoice (or OCR failed / still reading): straight to the count, against the order (RCV-14/15). */
  async function buildFromPoOnly(knownGrId: string | null) {
    try {
      const activeGrId = await ensureReceipt(knownGrId ?? grId);
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
        poLines: localizePoLines(poLines, localNamesRef.current),
        receiptLines: localizeReceiptLines(receipt.lines, localNamesRef.current),
        invoiceLines: [],
        invoiceMeta: null,
        labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
      });
      setResult(adapted.result);
      setGrLineIdByKey(adapted.grLineIdByKey);
      setMarks(withUnsent(keepAdjusted(marksRef.current, adapted.initialMarks, adjustedKeysRef.current), adapted.grLineIdByKey));
      setStep('ADJUST_QUANTITIES');
    } catch (err) {
      setError(errorText(err, t, locale));
      setStep('SCAN_INVOICE');
    }
  }

  // Reopened mid-receipt (reload, a call, the tab was evicted): resume the count
  // with every saved mark — never restart at the scan step (RCV-02).
  useEffect(() => {
    if (step !== 'RESUMING' || !existingReceipt) return;
    const draft = readDraft(draftKey);
    const knownInvoice = draft?.grId === existingReceipt.id ? draft.invoiceId : null;
    const serverProgress = existingReceipt.lines.some(
      (l) => Number(l.qtyReceived ?? 0) > 0 || Number(l.qtyRejected ?? 0) > 0 || Boolean(l.rejectReason),
    );
    if (!serverProgress && !knownInvoice && outbox.pendingCount() === 0 && !draft) {
      setStep('SCAN_INVOICE');
      return;
    }
    setResumed(true);
    void (async () => {
      if (knownInvoice) {
        setInvoiceId(knownInvoice);
        try {
          const inv = await utils.receiving.getInvoice.fetch({ invoiceId: knownInvoice });
          if (inv.status !== 'ocr_pending' && !inv.ocrFailed) {
            await showInvoice(existingReceipt.id, knownInvoice, 'ADJUST_QUANTITIES');
            return;
          }
          setOcrNotice(inv.ocrFailed ? (inv.ocrFailureReason === 'quota_exceeded' ? 'quota' : 'failed') : 'reading');
          if (!inv.ocrFailed) {
            const token = ++pollTokenRef.current;
            watchInBackground(knownInvoice, token).catch(() => null);
          }
        } catch {
          /* the invoice is gone or unreadable — count against the order */
        }
      }
      await buildFromPoOnly(existingReceipt.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function updateMark(key: string, patch: Partial<LineMark>) {
    const existing = marksRef.current[key];
    if (!existing) return;
    // An explicit `touched: false` is an undo / an unconfirmed weight; anything else resolves the line.
    const nextMark: LineMark = {
      ...existing,
      ...patch,
      touched: patch.touched ?? true,
      // A hand change is a per-line count unless the patch says how (bulk, spot check, undo).
      method: patch.method ?? 'per_line',
    };
    adjustedKeysRef.current.add(key);
    setMarks({ ...marksRef.current, [key]: nextMark });
    setFooterError(null);
    const grLineId = grLineIdByKeyRef.current[key];
    if (grLineId) outbox.set(payloadFor(grLineId, nextMark));
  }

  /** Close the receipt: every line is already saved (or flushed now); then submitReceipt re-matches. */
  async function submit() {
    if (!grId || !result) return;
    // Double-tap on "close receipt" must not submit twice.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setClosing(true);
    setFooterError(null);
    setError(null);
    try {
      const flushed = await outbox.flush();
      if (flushed.queued.length > 0 || !navigator.onLine) {
        setFooterError(td('delivery.count.offline'));
        return;
      }
      if (flushed.failed.length > 0) {
        setFooterError(td('delivery.count.saveFailed', { count: formatNumber(flushed.failed.length, locale) }));
        return;
      }
      pollTokenRef.current += 1; // stop background OCR polling
      await utils.client.receiving.submitReceipt.mutate({
        grId,
        // The count is in: the server re-matches this invoice against it. No
        // signature: the invoice photo is not a driver's signature (RCV-07/08).
        invoiceIds: invoiceId ? [invoiceId] : undefined,
      });
      setConfirmedAt(new Date().toISOString());
      setStep('CONFIRMED');
      writeDraft(draftKey, null);
      await utils.receiving.todayExpectations.invalidate();
      void findNextDelivery();
    } catch (err) {
      setFooterError(isNetworkError(err) ? td('delivery.count.offline') : errorText(err, t, locale));
    } finally {
      submittingRef.current = false;
      setClosing(false);
    }
  }

  /** "Next delivery: Galilee Dairies · 15:00 →" on the confirmation (RCV-30). */
  async function findNextDelivery() {
    try {
      const today = await utils.receiving.todayExpectations.fetch();
      const open = today
        .filter((e) => e.poId !== po.id && !isClosed(e.receiptStatus ?? undefined))
        .sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
      const n = open[0];
      if (!n) return;
      const name = locale === 'en' && n.supplierNameEn ? n.supplierNameEn : n.supplierName;
      setNext({
        poId: n.poId,
        label: n.hasDeliveryDate
          ? td('delivery.confirmed.nextAt', { supplier: name, time: formatDate(n.expectedAt, locale, { hour: '2-digit', minute: '2-digit' }) })
          : td('delivery.confirmed.next', { supplier: name }),
      });
    } catch {
      /* the list is the fallback */
    }
  }

  // Read-only view of a receipt that was closed before this visit.
  const closedView = useMemo(() => {
    if (!closedAtOpen) return null;
    const adapted = adaptReconciliation({
      po: { id: po.id, supplierId: po.supplierId, supplierName: po.supplierName, expectedAt: po.expectedAt, status: po.status, totalEstimated: po.totalEstimated },
      poLines: po.lines,
      receiptLines: closedAtOpen.lines,
      invoiceLines: [],
      invoiceMeta: null,
      labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
    });
    return adapted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedAtOpen]);

  const exceptions = result ? result.lines.filter((l) => lineIssues(l, marks[lineKey(l)]).length > 0).length : 0;

  return (
    <div
      ref={rootRef}
      // The field bar rides on top of the phone's bottom nav / the consent bar. The CSS default is the
      // nav's height, so the bar paints in place; useFieldBarOffset then only refines it (no jump under a tap).
      className="mx-auto max-w-3xl px-1 py-2 [--rm-field-bar-bottom:calc(3.3125rem+env(safe-area-inset-bottom)+var(--consent-h,0px))] lg:[--rm-field-bar-bottom:var(--consent-h,0px)]"
      data-mode="field"
    >
      {error ? (
        // Calm, in place: the receiver can keep going; the detail of a failed line is on the line itself.
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-danger/40 bg-surface px-4 py-3 text-base text-ink" dir={dir}>
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-base text-ink" dir={dir} data-testid="wizard-notice">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}

      {step === 'RESUMING' ? (
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-base text-muted" dir={dir}>
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          {t('loading')}
        </div>
      ) : null}

      {step === 'SUMMARY' && closedAtOpen && closedView ? (
        <>
          <ReceiptSummary
            status={closedAtOpen.status as 'completed' | 'partial'}
            receivedAt={closedAtOpen.receivedAt}
            result={closedView.result}
            marks={closedView.initialMarks}
          />
          {dockSlipOn ? (
            <div className="mx-auto max-w-md">
              <DockSlip
                grId={closedAtOpen.id}
                invoiceId={null}
                lines={closedView.result.lines}
                marks={closedView.initialMarks}
                duplicateNumber={null}
                fallbackSupplierName={supplierLabel}
                showMoney={showMoney}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {step === 'SCAN_INVOICE' ? (
        <InvoiceScan
          supplierName={supplierLabel}
          image={image}
          uploadFile={restaurantId ? authedUpload : undefined}
          onCapture={(img) => void onCapture(img)}
          onNoInvoice={() => void buildFromPoOnly(grId)}
        />
      ) : null}

      {step === 'PROCESSING' ? (
        <ProcessingPoll
          t={t}
          td={td}
          dir={dir}
          locale={locale}
          elapsedMs={elapsedMs}
          stillReading={elapsedMs >= STILL_READING_AFTER_MS}
          onSkip={() => {
            skipWaitRef.current = true;
          }}
        />
      ) : null}

      {ocrNotice && counting ? (
        <OcrNoticeBanner notice={ocrNotice} t={t} dir={dir} onRefresh={() => void refreshInvoice()} />
      ) : null}

      {duplicateNumber && counting ? (
        // Calm, not an alarm: the read is kept and goes to a human; receiving continues.
        <div
          role="status"
          data-testid="duplicate-invoice-notice"
          dir={dir}
          className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-base text-ink"
        >
          <Info className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <span className="flex-1">{t('steps.recon.duplicateInvoice', { number: duplicateNumber })}</span>
        </div>
      ) : null}

      {step === 'RECONCILIATION_REVIEW' && result ? (
        <Reconciliation
          result={result}
          showMoney={showMoney}
          lineExtra={dockPriceLineExtra}
          onContinueAdjust={() => setStep('ADJUST_QUANTITIES')}
          onRetake={() => {
            pollTokenRef.current += 1; // drop the old scan's pending result
            setOcrNotice(null);
            setDuplicateNumber(null);
            setInvoiceId(null);
            setImage(null);
            setStep('SCAN_INVOICE');
          }}
        >
          {/* Dock dispute slip (flag dockSlip): quantities on the review, before the count. */}
          {dockSlipOn && grId && slipNeeded ? (
            <div className="mt-4" dir={dir}>
              {showSlip ? (
                <DockSlip
                  grId={grId}
                  invoiceId={invoiceId}
                  lines={result.lines}
                  marks={marks}
                  duplicateNumber={duplicateNumber}
                  fallbackSupplierName={supplierLabel}
                  showMoney={showMoney}
                />
              ) : (
                <button
                  type="button"
                  data-testid="open-dock-slip"
                  onClick={() => setShowSlip(true)}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-2 text-base font-semibold text-ink"
                >
                  <FileWarning className="h-5 w-5 text-warn" aria-hidden="true" />
                  {t('dockSlip.open')}
                </button>
              )}
            </div>
          ) : null}
        </Reconciliation>
      ) : null}

      {step === 'ADJUST_QUANTITIES' && result ? (
        <>
          {result.invoiceMeta.noInvoice && !invoiceId && !image ? (
            // The invoice can still be photographed: marks are kept (count first, invoice in parallel — RCV-05).
            <div className="mb-3 flex justify-end" dir={dir}>
              <button
                type="button"
                onClick={() => setStep('SCAN_INVOICE')}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-base font-semibold text-ink"
                data-testid="count-scan-invoice"
              >
                <Camera className="h-5 w-5" aria-hidden="true" />
                {t('steps.scan.capture')}
              </button>
            </div>
          ) : null}
          <AdjustQuantities
            result={result}
            marks={marks}
            onUpdateMark={updateMark}
            onSubmit={() => void submit()}
            onBack={result.invoiceMeta.noInvoice ? undefined : () => setStep('RECONCILIATION_REVIEW')}
            eyebrow={supplierLabel}
            saveStates={saveStates}
            onRetrySave={() => void outbox.retry()}
            tolerance={tolerance}
            resumed={resumed}
            closing={closing}
            footerMessage={footerError}
          />
        </>
      ) : null}

      {step === 'CONFIRMED' ? (
        <Confirmed
          supplierName={supplierLabel}
          result={result}
          confirmedAt={confirmedAt}
          capturedImage={image}
          exceptions={exceptions}
          invoiceHref={invoiceId ? `/dashboard/invoices/${invoiceId}` : null}
          amount={showMoney && exceptions > 0 && !dockSlipOn ? td('delivery.confirmed.amountPending') : null}
          receivedBy={receiverName}
          bulkCount={Object.values(marks).filter((m) => m.touched && m.method === 'bulk_as_ordered').length}
          resetLabel={next?.label ?? t('steps.confirmed.backToInbox')}
          onReset={() => router.push(next ? `/dashboard/receiving/${next.poId}` : '/dashboard/receiving')}
        >
          {/* After the close the engine may add findings the count didn't show (VAT,
              total, duplicate): the slip decides itself whether there is anything to say. */}
          {result && dockSlipOn && grId ? (
            <DockSlip
              grId={grId}
              invoiceId={invoiceId}
              lines={result.lines}
              marks={marks}
              duplicateNumber={duplicateNumber}
              fallbackSupplierName={supplierLabel}
              showMoney={showMoney}
            />
          ) : null}
        </Confirmed>
      ) : null}

      <LeaveSheet
        target={leaveAsk}
        count={unsent}
        td={td}
        locale={locale}
        onStay={() => setLeaveAsk(null)}
        onLeave={() => {
          const target = leaveAsk;
          setLeaveAsk(null);
          if (target) leave(target);
        }}
      />
    </div>
  );
}

/** "N lines are not on the server yet — they are saved on the phone." Stay is the default. */
function LeaveSheet({
  target,
  count,
  td,
  locale,
  onStay,
  onLeave,
}: {
  target: LeaveTarget | null;
  count: number;
  td: Translator<typeof receivingDelivery.he>;
  locale: 'he' | 'en';
  onStay: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (target && !d.open) d.showModal();
    else if (!target && d.open) d.close();
  }, [target]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="rm-leave-title"
      data-testid="leave-sheet"
      onCancel={(e) => {
        e.preventDefault();
        onStay();
      }}
      className="!m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/50"
    >
      {target ? (
        <div className="space-y-3 p-5">
          <h2 id="rm-leave-title" className="text-lg font-bold">
            {td('delivery.leave.title')}
          </h2>
          <p className="text-base text-muted">{td('delivery.leave.body', { count: formatNumber(count, locale) })}</p>
          <div className="flex flex-col gap-2">
            <button type="button" autoFocus onClick={onStay} className="inline-flex min-h-14 items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-on-primary" data-testid="leave-stay">
              {td('delivery.leave.stay')}
            </button>
            <button type="button" onClick={onLeave} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-base font-medium text-ink" data-testid="leave-go">
              {td('delivery.leave.leave')}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

/** Banner on the count / review screens about the invoice read (EN-3 / EN-4). Calm tone. */
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
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-base ${
        notice === 'ready' ? 'border-primary/40 bg-surface text-ink' : 'border-line bg-surface-2 text-ink'
      }`}
    >
      <Info className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
      <span className="flex-1">{text}</span>
      {canRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-2 font-semibold text-ink"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {notice === 'ready' ? t('steps.processing.showResults') : t('steps.processing.refresh')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Reading the invoice (RCV-22, perf-states-11): honest stages from what is
 * actually known — the invoice is in (done), its lines are being read (with the
 * seconds so far), the comparison waits for that. Nothing loops, nothing ticks
 * "done" before it happened; "continue with the order" appears at 10 s.
 */
function ProcessingPoll({
  t,
  td,
  dir,
  locale,
  elapsedMs,
  stillReading,
  onSkip,
}: {
  t: Translator<typeof receiving.he>;
  td: Translator<typeof receivingDelivery.he>;
  dir: 'rtl' | 'ltr';
  locale: 'he' | 'en';
  elapsedMs: number;
  stillReading: boolean;
  onSkip: () => void;
}) {
  const seconds = formatNumber(Math.round(elapsedMs / 1000), locale);
  const stages = [
    { id: 'uploaded', label: td('delivery.processing.uploaded'), icon: FileScan, state: 'done' as const },
    { id: 'reading', label: td('delivery.processing.reading'), icon: Loader2, state: 'active' as const },
    { id: 'compare', label: td('delivery.processing.compare'), icon: Scale, state: 'waiting' as const },
  ];
  return (
    <div dir={dir} className="mx-auto max-w-md py-2">
      <StepHeader
        compact
        title={stillReading ? t('steps.processing.stillReadingTitle') : t('steps.processing.title')}
        subtitle={stillReading ? t('steps.processing.stillReading') : t('steps.processing.subtitleLive')}
      />
      <ol className="space-y-2 rounded-2xl border border-line bg-surface p-4" aria-label={t('steps.processing.eyebrow')}>
        {stages.map((s) => (
          <li key={s.id} className="flex min-h-12 items-center gap-3 text-base" aria-current={s.state === 'active' ? 'step' : undefined}>
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                s.state === 'waiting' ? 'border-line text-muted' : 'border-primary text-primary'
              }`}
            >
              {s.state === 'done' ? (
                <Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
              ) : s.state === 'active' ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <s.icon className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <span className={`flex-1 ${s.state === 'waiting' ? 'text-muted' : 'font-semibold text-ink'}`}>
              {s.state === 'active' ? <span role="status">{s.label}</span> : s.label}
            </span>
            {s.state === 'active' ? (
              <span className="tabular-nums text-muted" aria-hidden="true" data-testid="processing-elapsed">
                {td('delivery.processing.elapsed', { seconds })}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {stillReading ? (
        <button
          type="button"
          onClick={onSkip}
          data-testid="skip-ocr-wait"
          className="mt-4 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-bold text-on-primary"
        >
          {t('steps.processing.continueWithOrder')}
        </button>
      ) : null}
    </div>
  );
}
