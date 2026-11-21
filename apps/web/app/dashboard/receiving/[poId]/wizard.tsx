'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Check, FileScan, FileWarning, Info, Loader2, RefreshCw, Scale } from 'lucide-react';

import type { LineSaveUi } from '@/app/showcase/receiver/_steps/AdjustQuantities';
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
import { requestReauth } from '@/lib/net/reauth';
import { blobToBase64, ensureUploadable } from '@/lib/scanPrep';
import { isSessionExpired } from '@/lib/pwa/authGate';
import { SYNCED_EVENT, enqueuePhoto, idbAvailable, isNetworkError, isTransientFailure, type SyncedPhotoDetail } from '@/lib/pwa/offlineQueue';
import { adaptReconciliation, keepAdjusted, markFromCount, type PoLineRow, type ReceiptLineRow } from './_adapters';
import { failedReadNotice, onRegisterError, type OcrNotice } from './_capture';
import { fromGrLine } from './_count';
import { withoutStamp, type GrLinePayload, type RowStamp } from '@/lib/pwa/lineOutbox';
import { localizeInvoiceLines, localizePoLines, localizeReceiptLines, type LocalNames } from './_localize';
import { receivingErrorText as errorText } from './_errors';
import { pollInvoiceUntilRead } from './_poll';
import { buildSlipLines, lineIssues, needsSlip } from './_dockSlip';
import {
  payloadFor,
  payloadIsCounted,
  readDraft,
  readLocalMarks,
  writeLocalMarks,
  useLeaveGuard,
  useClaimReceiptGroup,
  useLineSaves,
  useFieldBarOffset,
  useWakeLock,
  writeDraft,
  type LeaveTarget,
} from './_fieldHooks';
import { clearCloseKey, closeKeyFor, uncountedLinesOf } from './_closeKey';
import { SUBMIT_RECEIPT_KIND, receiptGroup, type SubmitReceiptPayload } from '@/lib/pwa/fieldOutbox';
import { enqueue, idbOutboxStore, outboxKey } from '@/lib/pwa/outbox';
import { ReceiptSummary } from './receipt-summary';
import { dockGaps, restoredMark } from './_dock';
import type { DocState } from './dock-close-sheet';
import { DockCount } from './dock-count';
import { DockDone } from './dock-done';

// The slip is only needed once there is something to dispute: keep it out of the first load.
const DockSlip = dynamic(() => import('./dock-slip').then((m) => m.DockSlip), { ssr: false });

/** How long to keep checking in the background after the receiver moved on. */
const BACKGROUND_POLL_MS = 10 * 60_000;
/** After this long reading, offer "continue with the order" (perf-states-11, NN/g 10 s). */
export const STILL_READING_AFTER_MS = 10_000;


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
  /** Its open/close cycle (`updatedAt`): offline rows from an earlier cycle are held, never replayed. */
  version: string | null;
  /** W2-05: lines this receipt was closed with WITHOUT a count (recorded on the close). */
  closedUncounted?: number;
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
  countFirst = false,
  readOnly = false,
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
  /**
   * Flag `dockCountFirst` (DS3-05, an open owner decision, off by default): the
   * count comes first — a fresh order opens on it, the quantity sheet opens
   * empty, the document is photographed after the count (and never read on
   * screen while counting). Off: today's order of steps, unchanged.
   */
  countFirst?: boolean;
  /**
   * View only (IA-03: routeAccess(role, path) === 'read'). Every line, count and
   * invoice comparison stays visible; no photo, no receipt is started, no mark is
   * saved, no close, no dock slip. Default false: nothing changes for callers.
   */
  readOnly?: boolean;
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
  // Flag dockCountFirst: a fresh order opens on the count itself, built from the order alone. No
  // receipt yet: it starts on the receiver's first real action (a mark, the photo, the close).
  const [countFirstStart] = useState(() =>
    countFirst && !existingReceipt && !readOnly
      ? adaptReconciliation({
          po: { id: po.id, supplierId: po.supplierId, supplierName: po.supplierName, expectedAt: po.expectedAt, status: po.status, totalEstimated: po.totalEstimated },
          poLines: localizePoLines(po.lines, localNames ?? {}),
          receiptLines: [],
          invoiceLines: [],
          invoiceMeta: null,
          labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
        })
      : null,
  );
  const [step, setStep] = useState<Step>(
    closedAtOpen ? 'SUMMARY' : existingReceipt ? 'RESUMING' : countFirstStart ? 'ADJUST_QUANTITIES' : 'SCAN_INVOICE',
  );
  const [grId, setGrId] = useState<string | null>(existingReceipt?.id ?? null);
  /** The receipt id as of now (a lazily started receipt is known before the next render). */
  const grIdRef = useRef(grId);
  grIdRef.current = grId ?? grIdRef.current;
  /** The receipt's version as loaded now (changes only on close / reopen). */
  const [receiptVersion, setReceiptVersion] = useState<string | null>(closedAtOpen ? null : (existingReceipt?.version ?? null));
  const stampRef = useRef<RowStamp | null>(null);
  stampRef.current = grId && receiptVersion ? { grId, version: receiptVersion } : null;
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
  /** The scan whose invoice could not be registered — retried with one tap. */
  const [registerRetry, setRegisterRetry] = useState<CapturedImage | null>(null);
  /** Bumped on retake / skip / unmount — cancels any in-flight poll. */
  const pollTokenRef = useRef(0);
  const skipWaitRef = useRef(false);
  const submittingRef = useRef(false);
  const capturingRef = useRef(false);
  /** Lines the receiver changed by hand — kept when the review is rebuilt, never reset to the invoice. */
  const adjustedKeysRef = useRef(new Set<string>());
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [result, setResult] = useState<ReconciliationResult | null>(countFirstStart?.result ?? null);
  /** The count as of now (read inside callbacks created before it was built). */
  const resultRef = useRef(result);
  resultRef.current = result;
  const [marks, setMarksState] = useState<Record<string, LineMark>>(countFirstStart?.initialMarks ?? {});
  /** "צילום המסמך וסגירה": once the photo is in (or kept on the phone), the receipt closes. */
  const [closeAfterPhoto, setCloseAfterPhoto] = useState(false);
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
  // markGrLine / startReceipt / submitReceipt go through the plain client: the
  // field outbox owns their retries (kept on the phone, resent in order). They
  // bypass the QueryClient's caches, so W1-04's UNAUTHORIZED handler never sees
  // them — an expired session is turned into the re-auth sheet here
  // (requestReauth), never into "no connection". (Mutations already fail fast
  // offline: W1-04 made networkMode 'always' the app-wide default.)
  const uploadScan = trpc.scans.upload.useMutation();
  const ensureEnglish = trpc.receiving.ensureEnglish.useMutation();

  // Every mark is saved on change (300 ms, full row) and kept on the phone offline.
  const { outbox, states: saveByGrLine, pending: unsent, authGate } = useLineSaves(
    `rm-rcv-lines:${storeKey}`,
    (p) => utils.client.receiving.markGrLine.mutate(p),
    Boolean(closedAtOpen),
    // A row counted before this receipt was closed / reopened (another device closed
    // it; W1-05 reopened it for a follow-up delivery) is HELD — never replayed over
    // the count the match and claims were made against.
    (p) => {
      const cur = stampRef.current;
      if (!cur) return 'unknown';
      return p.stamp && p.stamp.grId === cur.grId && p.stamp.version === cur.version ? 'current' : 'stale';
    },
    restaurantId && userId ? { restaurantId, userId } : null,
  );
  // A queued close hands the receipt to the background drainer: release the group.
  const [closeQueued, setCloseQueued] = useState(false);
  useClaimReceiptGroup(closeQueued ? null : grId);
  // Once the receipt's version is known, sort the stored rows: current ones go, stale ones are held.
  useEffect(() => {
    if (grId && receiptVersion && !closedAtOpen) void outbox.retry();
  }, [grId, receiptVersion, closedAtOpen, outbox]);
  // Marks on invoice-only lines (no gr_line to save to) are kept on the device.
  const localMarksKey = `rm-rcv-unordered:${storeKey}`;
  const saveStates = useMemo(() => {
    const out: Record<string, LineSaveUi> = {};
    for (const [key, id] of Object.entries(grLineIdByKey)) {
      const st = saveByGrLine[id];
      if (st && st !== 'held') out[key] = st; // held rows are shown in their own panel
    }
    return out;
  }, [grLineIdByKey, saveByGrLine]);

  const counting = step === 'RECONCILIATION_REVIEW' || step === 'ADJUST_QUANTITIES';
  useFieldBarOffset(rootRef);
  useWakeLock(step !== 'CONFIRMED' && step !== 'SUMMARY');
  // Count first, before its receipt exists: the count is only on this phone, so leaving asks first too (RCV-02).
  const preCountUnsent =
    countFirst && Object.keys(grLineIdByKey).length === 0 ? Object.values(marks).filter((m) => m.touched).length : 0;
  const { leave } = useLeaveGuard((unsent > 0 || preCountUnsent > 0) && step !== 'CONFIRMED', setLeaveAsk);

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
      writeDraft(draftKey, { grId, invoiceId, savedAt: Date.now(), version: receiptVersion });
    }
  }, [grId, invoiceId, step, draftKey, receiptVersion]);

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
    async (picked: File, clientUploadId: string): Promise<UploadedScan> => {
      // Never send (or queue) more than Vercel's request body takes, nor a file the
      // browser can't decode: shrink first, or fail HERE with the scan step's
      // message — before any request (pilot: no photo may fail at the back door).
      const file = await ensureUploadable(picked);
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
      const contentBase64 = await blobToBase64(file);
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

  /** Count first: marks made before the receipt exists, kept on this phone until it does. */
  const preCountKey = `rm-rcv-precount:${storeKey}`;
  function writePreCount(next: Record<string, LineMark> | null) {
    try {
      if (next && Object.keys(next).length > 0) window.localStorage.setItem(preCountKey, JSON.stringify(next));
      else window.localStorage.removeItem(preCountKey);
    } catch {
      /* private mode: the marks stay on screen; they are sent once the receipt starts */
    }
  }
  /**
   * The counts kept on this phone, for the lines of `base` (this order's lines on screen). Only a
   * valid count of each (restoredMark): nothing stored is taken as it is.
   */
  function readPreCount(base: Record<string, LineMark>): Record<string, LineMark> {
    let saved: unknown = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(preCountKey) ?? '{}');
    } catch {
      saved = {};
    }
    if (!saved || typeof saved !== 'object') return {};
    const out: Record<string, LineMark> = {};
    for (const k of Object.keys(base)) {
      const m = restoredMark(base[k]!, (saved as Record<string, unknown>)[k]);
      if (m) out[k] = m;
    }
    return out;
  }
  /**
   * Count first, a receipt now known (a reload after it started, or another phone started it): the
   * counts this phone kept before it existed join it, for the lines it has no count for (a count
   * on the receipt stands). They are sent through the line outbox, and the phone's copy goes.
   */
  function adoptPreCount(merged: Record<string, LineMark>, grLineIds: Record<string, string>): Record<string, LineMark> {
    if (!countFirst || readOnly) return merged;
    const kept = readPreCount(merged);
    const keys = Object.keys(kept).filter((k) => !merged[k]?.touched);
    writePreCount(null);
    if (keys.length === 0) return merged;
    const out = { ...merged };
    for (const k of keys) {
      out[k] = kept[k]!;
      adjustedKeysRef.current.add(k);
      const grLineId = grLineIds[k];
      if (grLineId) outbox.set({ ...payloadFor(grLineId, kept[k]!), ...(stampRef.current ? { stamp: stampRef.current } : {}) });
    }
    setResumed(true);
    return out;
  }
  // A reload before the receipt could start (no signal at the first mark): the marks come back, and it starts.
  useEffect(() => {
    if (!countFirstStart) {
      // Opened on a closed receipt: a count kept on this phone has nothing left to join.
      if (countFirst && closedAtOpen) writePreCount(null);
      return;
    }
    const kept = readPreCount(marksRef.current);
    const keys = Object.keys(kept);
    if (keys.length === 0) return;
    for (const k of keys) adjustedKeysRef.current.add(k);
    setMarks({ ...marksRef.current, ...kept });
    setResumed(true);
    void startCountReceipt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The signal is back with marks still waiting for their receipt: start it now.
  useEffect(() => {
    if (!countFirst) return;
    const onOnline = () => {
      if (adjustedKeysRef.current.size > 0 && Object.keys(grLineIdByKeyRef.current).length === 0) void startCountReceipt();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countFirst]);

  /**
   * Flag dockCountFirst: the receipt starts on the receiver's first real action, never on page
   * view. Then the marks made before it existed are sent (the line outbox keeps them through a
   * lost signal). Failing to start (no signal, expired session) keeps every mark on screen and
   * says so by the close; the next action tries again. Resolves to the receipt id, or null.
   */
  const startingRef = useRef<Promise<string | null> | null>(null);
  function startCountReceipt(): Promise<string | null> {
    // Known with its lines: nothing to do. (The photo queue may have started it without them.)
    if (grIdRef.current && Object.keys(grLineIdByKeyRef.current).length > 0) return Promise.resolve(grIdRef.current);
    if (startingRef.current) return startingRef.current;
    const run = (async () => {
      try {
        const id = grIdRef.current ?? (await ensureReceipt(null));
        grIdRef.current = id;
        const receipt = await loadReceipt(id);
        noteVersion(id, receipt.updatedAt);
        const adapted = adaptReconciliation({
          po: { id: po.id, supplierId: po.supplierId, supplierName: po.supplierName, expectedAt: po.expectedAt, status: po.status, totalEstimated: po.totalEstimated },
          poLines: localizePoLines(poLines, localNamesRef.current),
          receiptLines: localizeReceiptLines(receipt.lines, localNamesRef.current),
          invoiceLines: [],
          invoiceMeta: null,
          labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
        });
        setGrLineIdByKey(adapted.grLineIdByKey);
        // A line this phone has not touched takes the receipt's own count (another phone may have
        // counted it), as every rebuild of the count does; what this phone counted stands and is sent.
        setMarks(withUnsent(keepAdjusted(marksRef.current, adapted.initialMarks, adjustedKeysRef.current), adapted.grLineIdByKey));
        for (const key of adjustedKeysRef.current) {
          const grLineId = adapted.grLineIdByKey[key];
          const m = marksRef.current[key];
          if (grLineId && m) outbox.set({ ...payloadFor(grLineId, m), ...(stampRef.current ? { stamp: stampRef.current } : {}) });
        }
        writePreCount(null); // the line outbox holds them now
        setFooterError(null);
        return id;
      } catch (err) {
        // Expired session: the re-auth sheet (a start is a mutation: the next tap starts it again,
        // never a replay). No signal: "no connection". Anything else says what the server said.
        const expired = isSessionExpired(err);
        if (expired) requestReauth();
        setFooterError(
          expired ? td('delivery.count.sessionExpired') : isTransientFailure(err) ? td('delivery.count.offline') : errorText(err, t, locale),
        );
        return null;
      } finally {
        startingRef.current = null;
      }
    })();
    startingRef.current = run;
    return run;
  }

  /** After capture: register the invoice for OCR, then poll until parsed. */
  const onCapture = useCallback(
    async (captured: CapturedImage) => {
      // M8: ignore a second tap while the first registration is in flight.
      if (capturingRef.current) return;
      capturingRef.current = true;
      setImage(captured);
      setError(null);
      setRegisterRetry(null);

      // Flag dockCountFirst: the document comes after the count. It is registered for reading
      // (or kept on the phone until it can upload) and the receiver goes straight back to the
      // count: no wait, no invoice review — the count stays blind, the engine reads it after the close.
      if (countFirst) {
        try {
          if (captured.publicUrl) {
            const activeGrId = await startCountReceipt();
            if (!activeGrId) throw new Error('no receipt');
            const reg = await registerInvoice.mutateAsync({ grId: activeGrId, imageUrl: captured.publicUrl, supplierId: po.supplierId });
            setInvoiceId(reg.invoiceId);
          } else if (offlineQueue && captured.invoiceId?.startsWith('queued-')) {
            setNotice(tIngest('pwa.savedOffline'));
          }
          // Back to the count; if it was never built here (reopened with no signal), build it now.
          if (resultRef.current) setStep('ADJUST_QUANTITIES');
          else await buildFromPoOnly(grIdRef.current);
        } catch {
          const failed = onRegisterError(captured);
          setRegisterRetry(failed.retry);
          setStep(failed.step);
        } finally {
          capturingRef.current = false;
        }
        return;
      }

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
      } catch {
        // Not saved: say so, with one-tap retry of the same scan — never a silent
        // count with no invoice (the receiver can still choose "no invoice now").
        const failed = onRegisterError(captured);
        setRegisterRetry(failed.retry);
        setStep(failed.step);
      } finally {
        capturingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grId, po.id, po.supplierId, locale, offlineQueue, countFirst],
  );

  // "צילום המסמך וסגירה": back on the count with the photo in (or kept on the phone) → close.
  useEffect(() => {
    if (!closeAfterPhoto || step !== 'ADJUST_QUANTITIES' || capturingRef.current) return;
    setCloseAfterPhoto(false);
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeAfterPhoto, step, invoiceId, image]);

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
      setOcrNotice(failedReadNotice(invoice?.ocrFailureReason));
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
      if (countFirst) {
        // Counted blind: the engine reads it after the close. The queue may have started the receipt: attach the count to it.
        if (adjustedKeysRef.current.size > 0) void startCountReceipt();
        return;
      }
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
    else if (outcome === 'failed') setOcrNotice(failedReadNotice(invoice?.ocrFailureReason));
  }

  /** Manual refresh from the count / review ("still reading" / "ready" banner). */
  async function refreshInvoice() {
    if (!invoiceId || !grId || submittingRef.current) return;
    const token = pollTokenRef.current;
    try {
      const inv = await utils.receiving.getInvoice.fetch({ invoiceId });
      // Closed, retaken or unmounted while the request was in flight.
      if (pollTokenRef.current !== token || submittingRef.current) return;
      if (inv.ocrFailed) setOcrNotice(failedReadNotice(inv.ocrFailureReason));
      else if (inv.status !== 'ocr_pending') await showInvoice(grId, invoiceId);
    } catch (err) {
      setError(errorText(err, t, locale));
    }
  }

  // Cancel polling on unmount.
  useEffect(() => () => {
    pollTokenRef.current += 1;
  }, []);

  /**
   * Overlay what THIS device wrote (unsent, or sent and acknowledged this
   * session) on a fresh server projection. The snapshot may predate a row the
   * outbox's retry just sent (the resume race): the local row wins, so a count
   * can never fall back to "not counted" and be overwritten by a bulk action.
   */
  function withUnsent(base: Record<string, LineMark>, idByKey: Record<string, string>): Record<string, LineMark> {
    const out = { ...base };
    for (const [key, m] of Object.entries(readLocalMarks(localMarksKey, stampRef.current))) {
      if (out[key] && !idByKey[key]) {
        out[key] = { ...out[key], ...m };
        adjustedKeysRef.current.add(key);
      }
    }
    const keyById = new Map(Object.entries(idByKey).map(([k, id]) => [id, k]));
    for (const p of outbox.latest()) {
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

  /**
   * getReceipt that never PAUSES offline (react-query's default networkMode
   * waits for the network — the receiver would be stuck on the scan step):
   * it fails at once, and then the cached copy stands in.
   */
  async function loadReceipt(activeGrId: string) {
    const input = { grId: activeGrId };
    try {
      return await utils.receiving.getReceipt.fetch(input, { networkMode: 'always', gcTime: Infinity });
    } catch (err) {
      const cached = utils.receiving.getReceipt.getData(input);
      if (cached && isTransientFailure(err)) return cached;
      throw err;
    }
  }

  /**
   * The receipt's version as just loaded. Set before the marks are restored, so
   * the restore (and the outbox) only ever take rows from THIS open/close cycle.
   */
  function noteVersion(activeGrId: string, updatedAt: string | Date | null | undefined) {
    const version = updatedAt ? new Date(updatedAt).toISOString() : null;
    stampRef.current = version ? { grId: activeGrId, version } : null;
    setReceiptVersion(version);
  }

  type InvoiceSnapshot = Awaited<ReturnType<typeof utils.receiving.getInvoice.fetch>>;
  async function buildReconciliation(activeGrId: string, invoice: InvoiceSnapshot, toStep: Step = 'RECONCILIATION_REVIEW') {
    const receipt = await loadReceipt(activeGrId);
    noteVersion(activeGrId, receipt.updatedAt);
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
      // Read-only never starts a receipt: the order alone (plus its receipt's counts, if one exists).
      const activeGrId = readOnly ? (knownGrId ?? grId) : await ensureReceipt(knownGrId ?? grId);
      const receipt = activeGrId ? await loadReceipt(activeGrId) : null;
      if (activeGrId && receipt) noteVersion(activeGrId, receipt.updatedAt);
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
        receiptLines: localizeReceiptLines(receipt?.lines ?? [], localNamesRef.current),
        invoiceLines: [],
        invoiceMeta: null,
        labels: { unnamed: t('unnamedItem'), unordered: t('unorderedItem') },
      });
      setResult(adapted.result);
      setGrLineIdByKey(adapted.grLineIdByKey);
      setMarks(
        adoptPreCount(withUnsent(keepAdjusted(marksRef.current, adapted.initialMarks, adjustedKeysRef.current), adapted.grLineIdByKey), adapted.grLineIdByKey),
      );
      setStep('ADJUST_QUANTITIES');
    } catch (err) {
      // The session expired (startReceipt / getReceipt said 401): the re-auth
      // sheet, and a message that says so — never "no connection".
      const expired = isSessionExpired(err);
      if (expired) requestReauth();
      // Offline (or signed out) with a count already on screen (the receiver went
      // to scan the invoice): back to that count, every mark kept, with the note
      // inline — never stranded on the scan step.
      if (isTransientFailure(err) && Object.keys(marksRef.current).length > 0) {
        setFooterError(td(expired ? 'delivery.count.sessionExpired' : 'delivery.count.offline'));
        setStep('ADJUST_QUANTITIES');
        return;
      }
      setError(expired ? td('delivery.count.sessionExpired') : errorText(err, t, locale));
      setStep('SCAN_INVOICE');
    }
  }

  // Read-only has no scan step: show the order (and any receipt counts) instead, once.
  const readOnlyBuiltRef = useRef(false);
  useEffect(() => {
    if (!readOnly || step !== 'SCAN_INVOICE' || readOnlyBuiltRef.current) return;
    readOnlyBuiltRef.current = true;
    void buildFromPoOnly(grId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, step]);

  // Reopened mid-receipt (reload, a call, the tab was evicted): resume the count
  // with every saved mark — never restart at the scan step (RCV-02).
  useEffect(() => {
    if (step !== 'RESUMING' || !existingReceipt) return;
    const draft = readDraft(draftKey);
    const serverProgress = existingReceipt.lines.some(
      (l) => Number(l.qtyReceived ?? 0) > 0 || Number(l.qtyRejected ?? 0) > 0 || Boolean(l.rejectReason),
    );
    void (async () => {
      // Closed on this phone with no signal, still waiting to send: show that, never the count again.
      if (restaurantId && userId) {
        const queued = await idbOutboxStore.get(outboxKey('submitReceipt', existingReceipt.id)).catch(() => undefined);
        if (queued && queued.restaurantId === restaurantId) {
          outbox.dispose();
          setCloseQueued(true);
          setStep('CONFIRMED');
          return;
        }
      }
      // Only an invoice read in THIS open/close cycle of the receipt (not before a close / reopen).
      // This phone's draft first; else the server's record (a reload after the draft was lost,
      // or another phone): resume at review — never a re-shoot, never a second OCR job (W2-05).
      let knownInvoice = draft?.grId === existingReceipt.id && draft.version === existingReceipt.version ? draft.invoiceId : null;
      if (!knownInvoice) {
        const server = await utils.receiving.resumeState
          .fetch({ poId: po.id }, { networkMode: 'always' })
          .catch(() => null);
        if (server?.grId === existingReceipt.id && server.version === existingReceipt.version && server.invoice) {
          knownInvoice = server.invoice.invoiceId;
        }
      }
      if (!serverProgress && !knownInvoice && outbox.pendingCount() === 0 && !draft) {
        // Count first: the count is the first screen, receipt or not.
        if (countFirst) await buildFromPoOnly(existingReceipt.id);
        else setStep('SCAN_INVOICE');
        return;
      }
      setResumed(true);
      if (knownInvoice && countFirst) {
        // Counted blind: the photographed invoice is kept for the close, never shown while counting.
        setInvoiceId(knownInvoice);
      } else if (knownInvoice) {
        setInvoiceId(knownInvoice);
        try {
          const inv = await utils.receiving.getInvoice.fetch({ invoiceId: knownInvoice });
          if (inv.status !== 'ocr_pending' && !inv.ocrFailed) {
            await showInvoice(existingReceipt.id, knownInvoice, 'ADJUST_QUANTITIES');
            return;
          }
          setOcrNotice(inv.ocrFailed ? (failedReadNotice(inv.ocrFailureReason)) : 'reading');
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
    if (readOnly) return; // view only: nothing is marked or saved
    const existing = marksRef.current[key];
    // Nothing changes while the receipt is closing (it would be saved after the close).
    if (!existing || submittingRef.current) return;
    // An explicit `touched: false` is an undo / an unconfirmed weight; anything else resolves the line.
    const nextMark: LineMark = {
      ...existing,
      ...patch,
      touched: patch.touched ?? true,
      // A hand change is a per-line count unless the patch says how (bulk, spot check, undo).
      method: patch.method ?? 'per_line',
      unconfirmed: patch.unconfirmed ?? false,
    };
    adjustedKeysRef.current.add(key);
    setMarks({ ...marksRef.current, [key]: nextMark });
    setFooterError(null);
    const grLineId = grLineIdByKeyRef.current[key];
    if (grLineId) outbox.set({ ...payloadFor(grLineId, nextMark), ...(stampRef.current ? { stamp: stampRef.current } : {}) });
    else if (countFirst && Object.keys(grLineIdByKeyRef.current).length === 0) {
      // No receipt yet: keep the count on the phone, start the receipt; it sends this mark once it exists.
      writePreCount(Object.fromEntries(Object.entries(marksRef.current).filter(([, m]) => m.touched)));
      void startCountReceipt();
    }
    else {
      // Invoice-only line: no gr_line exists — keep it on the device so a reload restores it.
      const local = readLocalMarks(localMarksKey, stampRef.current);
      local[key] = nextMark;
      writeLocalMarks(localMarksKey, local, stampRef.current);
    }
  }

  /**
   * Rows counted on this phone before the receipt was closed / reopened. Never
   * replayed and never dropped unseen: the receiver applies or discards each.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const heldRows = useMemo(() => outbox.held(), [outbox, saveByGrLine]);

  /** "Apply": the phone's count becomes the count of THIS cycle (re-stamped, sent, shown). */
  function applyHeld(p: GrLinePayload) {
    const key = Object.entries(grLineIdByKeyRef.current).find(([, id]) => id === p.grLineId)?.[0];
    const m = key ? marksRef.current[key] : undefined;
    if (!key || !m || !stampRef.current) return;
    const row = withoutStamp(p);
    const counted = payloadIsCounted(row);
    setMarks({
      ...marksRef.current,
      [key]: counted ? markFromCount(m, fromGrLine(row, null), m.qtyReceived, row.conditionNotes ?? null) : { ...m, touched: false },
    });
    adjustedKeysRef.current.add(key);
    outbox.set({ ...row, stamp: stampRef.current });
  }

  /** Put the close in the field outbox (offline) and show it as closed on the phone, waiting to send. */
  async function queueClose(activeGrId: string, version: string | null) {
    await enqueue(
      idbOutboxStore,
      'submitReceipt',
      {
        grId: activeGrId,
        clientMutationId: closeKeyFor(activeGrId, version),
        invoiceIds: invoiceId ? [invoiceId] : undefined,
      } satisfies SubmitReceiptPayload,
      { restaurantId: restaurantId!, userId: userId!, capturedByName: receiverName ?? null, group: receiptGroup(activeGrId) },
      { idempotencyKey: SUBMIT_RECEIPT_KIND.idempotencyKey({ grId: activeGrId, clientMutationId: '' }) },
    );
    // From here the shell's drainer owns this receipt: its rows, then the close, in order.
    outbox.dispose();
    setCloseQueued(true);
    setConfirmedAt(new Date().toISOString());
    setStep('CONFIRMED');
  }

  /** Close the receipt: every line is already saved (or flushed now); then submitReceipt re-matches. */
  async function submit(started: string | null = null) {
    // Count first: the receipt starts on the first action; a close before it exists starts it now.
    if (countFirst && !started && (!grIdRef.current || Object.keys(grLineIdByKeyRef.current).length === 0) && !readOnly && result) {
      const id = await startCountReceipt();
      if (id) await submit(id);
      return;
    }
    const grId = started ?? grIdRef.current;
    if (readOnly || !grId || !result) return;
    // This open/close cycle's version as of now (a receipt started a moment ago is not in state yet).
    const version = stampRef.current?.grId === grId ? stampRef.current.version : receiptVersion;
    // Double-tap on "close receipt" must not submit twice.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setClosing(true);
    setFooterError(null);
    setError(null);
    try {
      const flushed = await outbox.flush();
      if (flushed.queued.length > 0 || !navigator.onLine) {
        // Lines held back by an expired session (a 401 on the flush): sign in, not "offline".
        if (authGate.blocked) {
          requestReauth();
          setFooterError(td('delivery.count.sessionExpired'));
        } else if (restaurantId && userId && flushed.failed.length === 0) {
          // No signal (W2-05): the close waits in the field outbox behind this receipt's counts and
          // goes by itself — the same close key, so it is ONE close however often it is retried.
          await queueClose(grId, version);
        } else setFooterError(td('delivery.count.offline'));
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
        // ONE close per intent (W2-05): a retry after a lost answer, a reload or a
        // double tap replays the same close — one close, one re-match.
        clientMutationId: closeKeyFor(grId, version),
      });
      setConfirmedAt(new Date().toISOString());
      setStep('CONFIRMED');
      writeDraft(draftKey, null);
      clearCloseKey(grId, version);
      // Closed: nothing left to send or restore for this receipt.
      outbox.clear();
      writeLocalMarks(localMarksKey, null);
      await utils.receiving.todayExpectations.invalidate();
      void findNextDelivery();
    } catch (err) {
      if (isSessionExpired(err)) {
        requestReauth();
        setFooterError(td('delivery.count.sessionExpired'));
      } else {
        const uncounted = uncountedLinesOf(err);
        setFooterError(
          uncounted !== null
            ? td('delivery.count.uncounted', { count: formatNumber(uncounted, locale) })
            : isNetworkError(err)
              ? td('delivery.count.offline')
              : errorText(err, t, locale),
        );
      }
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
  // Registered for reading, or kept on the phone until it can upload (S13), or not photographed.
  const docState: DocState = invoiceId ? 'done' : image?.invoiceId?.startsWith('queued-') ? 'queued' : 'none';

  return (
    <div
      ref={rootRef}
      // The field bar rides on top of the consent bar. This page is a field route (W1-03's nav
      // registry), so the shell renders no phone bottom nav here: the CSS default is the consent bar
      // alone and the bar paints in place; useFieldBarOffset then only refines it. (A default of the
      // old nav's height painted the bar 53 px up, then dropped it under the receiver's thumb.)
      className="mx-auto max-w-3xl px-1 py-2 [--rm-field-bar-bottom:var(--consent-h,0px)]"
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
            // The manager sees what was closed without a count (T4, never a false alarm); the receiver doesn't.
            closedUncounted={showMoney ? (closedAtOpen.closedUncounted ?? 0) : 0}
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

      {step === 'SCAN_INVOICE' && registerRetry && !readOnly ? (
        <div role="alert" dir={dir} className="mb-4 space-y-3 rounded-2xl border border-warn/60 bg-surface p-4" data-testid="register-failed">
          <p className="text-base font-semibold text-ink">{td('delivery.scan.registerFailed')}</p>
          <button
            type="button"
            onClick={() => void onCapture(registerRetry)}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-primary bg-surface px-4 text-base font-semibold text-primary"
            data-testid="register-retry"
          >
            <RefreshCw className="h-5 w-5" aria-hidden="true" />
            {td('delivery.scan.registerRetry')}
          </button>
        </div>
      ) : null}
      {step === 'SCAN_INVOICE' && !readOnly ? (
        <InvoiceScan
          supplierName={supplierLabel}
          image={image}
          uploadFile={restaurantId ? authedUpload : undefined}
          onCapture={(img) => void onCapture(img)}
          onNoInvoice={() => {
            // Count first: back to the count (marks kept), and no close waiting on a photo.
            if (countFirst && result) {
              setCloseAfterPhoto(false);
              setStep('ADJUST_QUANTITIES');
            } else void buildFromPoOnly(grId);
          }}
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
        <OcrNoticeBanner notice={ocrNotice} t={t} td={td} dir={dir} onRefresh={() => void refreshInvoice()} />
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
          readOnly={readOnly}
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
          {dockSlipOn && grId && slipNeeded && !readOnly ? (
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
          {heldRows.length > 0 && !readOnly ? (
            <HeldCounts
              rows={heldRows}
              result={result}
              marks={marks}
              grLineIdByKey={grLineIdByKey}
              onApply={applyHeld}
              onDiscard={(p) => outbox.discard(p.grLineId)}
              dir={dir}
              td={td}
              locale={locale}
            />
          ) : null}
          <DockCount
            result={result}
            marks={marks}
            onUpdateMark={updateMark}
            onSubmit={() => void submit()}
            onBack={result.invoiceMeta.noInvoice ? undefined : () => setStep('RECONCILIATION_REVIEW')}
            supplierName={supplierLabel}
            saveStates={saveStates}
            onRetrySave={() => void outbox.retry()}
            tolerance={tolerance}
            resumed={resumed}
            closing={closing}
            footerMessage={footerError}
            countFirst={countFirst}
            doc={docState}
            // The document can still be photographed: marks are kept (count first, invoice in parallel — RCV-05).
            onPhoto={
              (countFirst ? docState === 'none' : result.invoiceMeta.noInvoice && !invoiceId && !image) && !readOnly
                ? (opts) => {
                    setCloseAfterPhoto(Boolean(countFirst && opts?.closeAfter));
                    setStep('SCAN_INVOICE');
                  }
                : undefined
            }
            readOnly={readOnly}
          />
        </>
      ) : null}

      {step === 'CONFIRMED' ? (
        <DockDone
          supplierName={supplierLabel}
          result={result}
          confirmedAt={confirmedAt}
          // The invoice page and the scan are full of ₪: no link for the receiver / chef (owner decision).
          capturedImage={showMoney ? image : null}
          invoiceHref={showMoney && invoiceId ? `/dashboard/invoices/${invoiceId}` : null}
          invoiceNumber={result && !result.invoiceMeta.noInvoice ? result.invoiceMeta.invoiceNumber || null : null}
          amount={showMoney && exceptions > 0 && !dockSlipOn ? td('delivery.confirmed.amountPending') : null}
          receivedBy={receiverName}
          bulkCount={Object.values(marks).filter((m) => m.touched && m.method === 'bulk_as_ordered').length}
          gaps={dockGaps(result, marks, tolerance)}
          // The invoice or the slip still has something to say: a clean count is not called "all as ordered".
          otherFindings={exceptions > 0 || slipNeeded}
          doc={docState}
          countFirst={countFirst}
          closeQueued={closeQueued}
          resetLabel={next?.label ?? t('steps.confirmed.backToInbox')}
          onReset={() => router.push(next ? `/dashboard/receiving/${next.poId}` : '/dashboard/receiving')}
          listLabel={next ? t('steps.confirmed.backToInbox') : undefined}
          onList={next ? () => router.push('/dashboard/receiving') : undefined}
        >
          {/* After the close the engine may add findings the count didn't show (VAT,
              total, duplicate): the slip decides itself whether there is anything to say. */}
          {result && dockSlipOn && grId && !closeQueued ? (
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
        </DockDone>
      ) : null}

      <LeaveSheet
        target={leaveAsk}
        count={unsent + preCountUnsent}
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
  td,
  dir,
  onRefresh,
}: {
  notice: Exclude<OcrNotice, null>;
  t: Translator<typeof receiving.he>;
  td: Translator<typeof receivingDelivery.he>;
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
          : notice === 'disabled'
            ? td('delivery.processing.ocrDisabled') // calm: this account doesn't read invoices — not an error
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

/** The held rows (counted before the receipt was closed / reopened), each with apply / discard. */
function HeldCounts({
  rows,
  result,
  marks,
  grLineIdByKey,
  onApply,
  onDiscard,
  dir,
  td,
  locale,
}: {
  rows: GrLinePayload[];
  result: ReconciliationResult;
  marks: Record<string, LineMark>;
  grLineIdByKey: Record<string, string>;
  onApply: (p: GrLinePayload) => void;
  onDiscard: (p: GrLinePayload) => void;
  dir: 'rtl' | 'ltr';
  td: Translator<typeof receivingDelivery.he>;
  locale: 'he' | 'en';
}) {
  const keyById = new Map(Object.entries(grLineIdByKey).map(([k, id]) => [id, k]));
  const qty = (q: number) => formatNumber(q, locale, { maximumFractionDigits: 3 });
  const phoneText = (p: GrLinePayload) =>
    p.rejectReason === 'missing' ? td('delivery.count.missingTag') : payloadIsCounted(p) ? qty(p.qtyReceived) : td('delivery.count.heldNotCounted');
  const recordText = (m: LineMark | undefined) =>
    !m?.touched ? td('delivery.count.heldNotCounted') : m.rejectReason === 'missing' ? td('delivery.count.missingTag') : qty(m.qtyReceived);
  return (
    <section dir={dir} role="alert" className="mb-4 space-y-3 rounded-2xl border border-warn/60 bg-surface p-4" data-testid="held-counts">
      <div>
        <p className="text-base font-semibold text-ink">{td('delivery.count.heldTitle')}</p>
        <p className="text-sm text-muted">{td('delivery.count.heldBody')}</p>
      </div>
      <ul className="space-y-3">
        {rows.map((p) => {
          const key = keyById.get(p.grLineId);
          const line = key ? result.lines.find((l) => lineKey(l) === key) : undefined;
          const name = line ? (locale === 'en' && line.productNameEn ? line.productNameEn : line.productName) : '—';
          return (
            <li key={p.grLineId} className="space-y-2" data-testid="held-line" data-grline={p.grLineId}>
              <p className="text-base text-ink">
                {td('delivery.count.heldLine', { name, phone: phoneText(p), record: recordText(key ? marks[key] : undefined) })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onApply(p)}
                  className="inline-flex min-h-12 items-center rounded-xl border border-primary bg-surface px-4 text-base font-semibold text-primary"
                  data-testid="held-apply"
                >
                  {td('delivery.count.heldApply')}
                </button>
                <button
                  type="button"
                  onClick={() => onDiscard(p)}
                  className="inline-flex min-h-12 items-center rounded-xl border border-line-strong bg-surface px-4 text-base font-semibold text-ink"
                  data-testid="held-discard"
                >
                  {td('delivery.count.heldDiscard')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
