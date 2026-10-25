'use client';

import { AlertTriangle, ArrowLeft, ArrowRight, Camera, CheckCircle2, CloudUpload, FileText, FileUp, ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { receivingErrorText } from '@/app/dashboard/receiving/[poId]/_errors';
import { receiving } from '@/lib/i18n/messages/receiving';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import type { Translator } from '@/lib/i18n/translate';
import {
  ShowcaseUploadError,
  SupabaseNotConfiguredError,
  uploadInvoiceScan,
  type UploadedScan,
} from '@/lib/supabase/client';
import { prepareScanFile, ScanPrepError } from './scanPrep';
import { checkScanQuality, type ScanQualityIssue } from './scanQuality';
import type { CapturedImage } from '../_state';
import { ActionBar, PRIMARY_56, SECONDARY_48 } from './ActionBar';
import { StepHeader } from './SupplierSelect';

interface Props {
  supplierName: string;
  image: CapturedImage | null;
  onCapture: (image: CapturedImage) => void;
  /** Showcase: back to the supplier step. The dashboard leaves it out (one exit, at the top). */
  onBack?: () => void;
  /**
   * Authenticated upload path: when provided, the file is uploaded via the
   * SERVER (scans.upload mutation) which derives the tenant + storage path from
   * the session — the browser never chooses a restaurant id or prefix. The
   * anonymous showcase leaves this undefined and falls back to the walk-ins/
   * uploader above.
   */
  uploadFile?: (file: File, clientUploadId: string) => Promise<UploadedScan>;
  /** Label for the back link (defaults to "back to supplier"). */
  backLabel?: string;
  /**
   * Live flow: "no invoice right now — receive against the order" (RCV-16).
   * The demo-invoice button exists only where there is no real upload (the showcase).
   */
  onNoInvoice?: () => void;
  /** Eyebrow over the title; the showcase shows its step number. */
  eyebrow?: string;
}

/** One id per file selection — a retried/double-submitted upload reuses it (M8). */
function newUploadId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16),
  );
}

type UploadState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'quality'; issue: ScanQualityIssue; file: File }
  | { phase: 'uploading'; startedAt: number }
  | { phase: 'uploaded'; result: CapturedImage }
  | { phase: 'error'; message: string };

/**
 * Invoice capture (RCV-03, RCV-16, mobile-field-04 v1). The primary opens the
 * REAR CAMERA (`capture="environment"`); a separate text link uploads a file or
 * PDF. A photo gets a sub-second blur/darkness check with a named reason before
 * it is uploaded. No decorative motion (a11y-07, mobile-field-23).
 */
export function InvoiceScan({ supplierName, image, onCapture, onBack, uploadFile, backLabel, onNoInvoice, eyebrow }: Props) {
  const t = useT(receiving);
  const td = useT(receivingDelivery);
  const locale = useLocale();
  const dir = useDir();
  const capturedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** What the frame shows: the picked file (drawn, never put into a URL attribute), the demo page, or nothing. */
  const [preview, setPreview] = useState<{ kind: 'file'; file: File } | { kind: 'demo' } | { kind: 'kept' } | null>(
    image ? { kind: 'kept' } : null,
  );
  const [upload, setUpload] = useState<UploadState>(
    image?.invoiceId ? { phase: 'uploaded', result: image } : { phase: 'idle' },
  );
  const [now, setNow] = useState(() => Date.now());

  // Honest progress: elapsed seconds while the upload runs (no fake percentage).
  useEffect(() => {
    if (upload.phase !== 'uploading') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [upload.phase]);

  async function handleFile(file: File, skipQuality = false) {
    const localUrl = URL.createObjectURL(file);
    setPreview({ kind: 'file', file });
    if (!skipQuality && file.type.startsWith('image/')) {
      setUpload({ phase: 'checking' });
      const issue = await checkScanQuality(file);
      if (issue) {
        setUpload({ phase: 'quality', issue, file });
        return;
      }
    }

    // EN-2: shrink phone photos in the browser first (Vercel's 4.5 MB request
    // limit), then upload. Authenticated flow: server `scans.upload`
    // (uploadFile); anonymous showcase: the server /api/showcase/upload endpoint.
    setUpload({ phase: 'uploading', startedAt: Date.now() });
    setNow(Date.now());
    try {
      const prepared = (await prepareScanFile(file)).file;
      const uploaded = uploadFile
        ? await uploadFile(prepared, newUploadId())
        : await uploadInvoiceScan(prepared, { filename: prepared.name });
      setUpload({
        phase: 'uploaded',
        result: {
          url: localUrl,
          filename: file.name,
          invoiceId: uploaded.invoiceId,
          scanRouteUrl: uploaded.scanRouteUrl,
          publicUrl: uploaded.publicUrl,
          mimeType: uploaded.mimeType,
        },
      });
    } catch (err) {
      if (err instanceof SupabaseNotConfiguredError) {
        // Showcase mode without Supabase env: keep going with local preview
        setUpload({ phase: 'uploaded', result: { url: localUrl, filename: file.name } });
      } else {
        // Coded failures are translated; quota / subscription / auth errors go
        // through receivingErrorText — never raw server text.
        setUpload({ phase: 'error', message: uploadErrorText(err) });
      }
    }
  }

  function uploadErrorText(err: unknown): string {
    const code =
      err instanceof ScanPrepError || err instanceof ShowcaseUploadError ? err.code : null;
    if (code === 'too_large') {
      return t('steps.scan.tooLarge', {
        mb: err instanceof ScanPrepError ? err.maxMb : 3,
      });
    }
    if (code === 'unsupported_type' || code === 'type_mismatch') return t('steps.scan.unsupportedType');
    if (code === 'too_many_requests') return t('steps.scan.rateLimited');
    if (code === 'network') return t('steps.scan.network');
    if (code === 'upload_failed') return t('steps.scan.uploadFailed', { message: t('errors.generic') });
    // Authed path (scans.upload over tRPC): offline → network message; only
    // coded/mapped errors are shown specifically, never raw server text.
    return t('steps.scan.uploadFailed', { message: receivingErrorText(err, t, locale) });
  }

  /**
   * One file input, two intents: its resting state is the rear camera
   * (`accept="image/*" capture="environment"`); "upload a file / PDF" lifts the
   * capture hint and widens `accept` for that one pick.
   */
  function pick(kind: 'camera' | 'file') {
    const input = inputRef.current;
    if (!input) return;
    capturedRef.current = false;
    if (kind === 'file') {
      input.removeAttribute('capture');
      input.accept = 'image/*,application/pdf';
    } else restoreCamera(input);
    input.click();
  }

  function restoreCamera(input: HTMLInputElement) {
    input.setAttribute('capture', 'environment');
    input.accept = 'image/*';
  }

  const openCamera = () => pick('camera');

  function useMockImage() {
    const mockUrl =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560"><rect width="400" height="560" fill="%23f8fafc"/><rect x="40" y="40" width="320" height="40" fill="%23e2e8f0"/><rect x="40" y="100" width="200" height="20" fill="%23cbd5e1"/><rect x="40" y="130" width="160" height="20" fill="%23cbd5e1"/><line x1="40" y1="180" x2="360" y2="180" stroke="%2394a3b8" stroke-width="1"/><rect x="40" y="200" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="225" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="250" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="275" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="300" width="320" height="14" fill="%23e2e8f0"/><line x1="40" y1="340" x2="360" y2="340" stroke="%2394a3b8" stroke-width="1"/><rect x="200" y="360" width="160" height="20" fill="%231e293b"/></svg>`,
      );
    setPreview({ kind: 'demo' });
    setUpload({ phase: 'uploaded', result: { url: mockUrl, filename: 'invoice-mock.svg' } });
  }

  function confirmCapture() {
    if (upload.phase !== 'uploaded') return;
    // M8: a double-tap must not register the same invoice twice.
    if (capturedRef.current) return;
    capturedRef.current = true;
    onCapture(upload.result);
  }

  function reset() {
    capturedRef.current = false;
    setPreview(null);
    setUpload({ phase: 'idle' });
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same photo again still fires
    restoreCamera(e.target);
    if (file) void handleFile(file);
  };

  const hasPhoto = preview !== null && upload.phase !== 'idle';
  const elapsed = upload.phase === 'uploading' ? Math.max(0, Math.round((now - upload.startedAt) / 1000)) : 0;

  return (
    <div dir={dir}>
      <StepHeader
        compact
        eyebrow={eyebrow}
        title={t('steps.scan.title')}
        subtitle={t('steps.scan.subtitle', { supplier: supplierName })}
      />

      <UploadStatus state={upload} t={t} td={td} elapsed={formatNumber(elapsed, locale)} />

      {/* A framing hint, not a camera: kept short so the actions stay in reach (RCV-06). */}
      <div className="relative mx-auto mb-4 flex h-[min(30vh,16rem)] max-w-md items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface-2">
        {preview?.kind === 'file' ? (
          <FilePreview file={preview.file} label={t('steps.scan.invoiceAlt')} />
        ) : preview ? (
          <FileText className="h-16 w-16 text-muted" role="img" aria-label={t('steps.scan.invoiceAlt')} />
        ) : (
          <>
            <div className="flex flex-col items-center justify-center text-muted">
              <Camera className="mb-2 h-12 w-12" aria-hidden="true" />
              <p className="text-base">{t('steps.scan.frameHint')}</p>
            </div>
            <div aria-hidden="true" className="absolute top-4 start-4 h-8 w-8 rounded-ss-lg border-s-2 border-t-2 border-primary" />
            <div aria-hidden="true" className="absolute top-4 end-4 h-8 w-8 rounded-se-lg border-e-2 border-t-2 border-primary" />
            <div aria-hidden="true" className="absolute bottom-4 start-4 h-8 w-8 rounded-es-lg border-b-2 border-s-2 border-primary" />
            <div aria-hidden="true" className="absolute bottom-4 end-4 h-8 w-8 rounded-ee-lg border-b-2 border-e-2 border-primary" />
          </>
        )}
      </div>

      {/* Rear camera first; a file / PDF is a separate, explicit choice (RCV-03) on the same input. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="scan-input"
        onChange={onPick}
      />

      {!hasPhoto || upload.phase === 'error' ? (
        <div className="mx-auto flex max-w-md flex-col items-center">
          <button type="button" onClick={() => pick('file')} className={SECONDARY_48} data-testid="scan-upload-file">
            <FileUp className="h-5 w-5" aria-hidden="true" />
            {td('delivery.scan.upload')}
          </button>
        </div>
      ) : null}

      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="mt-4 inline-flex min-h-12 items-center gap-2 text-base text-muted hover:text-ink"
        >
          <ArrowRight className="h-4 w-4 ltr:-scale-x-100" aria-hidden="true" />
          {backLabel ?? t('steps.scan.backToSupplier')}
        </button>
      ) : null}

      <ActionBar testId="scan-actions">
        {upload.phase === 'quality' ? (
          <>
            <button
              type="button"
              onClick={() => void handleFile(upload.file, true)}
              className={SECONDARY_48}
              data-testid="scan-use-anyway"
            >
              {td('delivery.scan.useAnyway')}
            </button>
            <button type="button" onClick={openCamera} className={PRIMARY_56}>
              <RefreshCw className="h-5 w-5" aria-hidden="true" />
              {t('steps.scan.retake')}
            </button>
          </>
        ) : hasPhoto && upload.phase !== 'error' ? (
          <>
            <button type="button" onClick={reset} className={SECONDARY_48}>
              <RefreshCw className="h-5 w-5" aria-hidden="true" />
              {t('steps.scan.retake')}
            </button>
            <button
              type="button"
              onClick={confirmCapture}
              disabled={upload.phase !== 'uploaded'}
              className={PRIMARY_56}
              data-testid="scan-process"
            >
              {upload.phase === 'uploaded' ? t('steps.scan.process') : t('steps.scan.uploading')}
              {upload.phase === 'uploaded' ? <ArrowLeft className="h-5 w-5 ltr:-scale-x-100" aria-hidden="true" /> : null}
            </button>
          </>
        ) : (
          <>
            {onNoInvoice ? (
              <button type="button" onClick={onNoInvoice} className={SECONDARY_48} data-testid="scan-no-invoice">
                {td('delivery.scan.noInvoice')}
              </button>
            ) : !uploadFile ? (
              // Showcase only: there is no real upload to make (never on a real delivery — RCV-16).
              <button type="button" onClick={useMockImage} className={SECONDARY_48} data-testid="scan-use-demo">
                <ImageIcon className="h-5 w-5" aria-hidden="true" />
                {t('steps.scan.useDemo')}
              </button>
            ) : null}
            <button type="button" onClick={openCamera} className={PRIMARY_56} data-testid="scan-capture">
              <Camera className="h-6 w-6" aria-hidden="true" />
              {t('steps.scan.capture')}
            </button>
          </>
        )}
      </ActionBar>
    </div>
  );
}

/**
 * The picked photo, decoded and drawn on a canvas (contain-fit). A PDF, or a
 * browser that cannot decode the image, shows a document icon instead.
 */
function FilePreview({ file, label }: { file: File; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') {
      setFailed(true);
      return;
    }
    createImageBitmap(file)
      .then((bmp) => {
        const canvas = ref.current;
        if (cancelled || !canvas) return bmp.close();
        const box = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(box.width * dpr));
        canvas.height = Math.max(1, Math.round(box.height * dpr));
        const scale = Math.min(canvas.width / bmp.width, canvas.height / bmp.height);
        const w = bmp.width * scale;
        const h = bmp.height * scale;
        canvas.getContext('2d')?.drawImage(bmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        bmp.close();
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [file]);
  if (failed) return <FileText className="h-16 w-16 text-muted" role="img" aria-label={label} />;
  return <canvas ref={ref} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />;
}

function UploadStatus({
  state,
  t,
  td,
  elapsed,
}: {
  state: UploadState;
  t: Translator<typeof receiving.he>;
  td: Translator<typeof receivingDelivery.he>;
  elapsed: string;
}) {
  const box = 'mx-auto mb-4 flex max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-base';
  // Live region is always mounted so a change is announced (a11y-07).
  return (
    <div role="status" aria-live="polite" data-testid="scan-status">
      {state.phase === 'checking' ? (
        <p className={`${box} border-line bg-surface text-ink`}>
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
          {td('delivery.scan.checking')}
        </p>
      ) : state.phase === 'quality' ? (
        <p className={`${box} border-line bg-surface-2 text-ink`} data-testid="scan-quality">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          {td(`delivery.scan.${state.issue}`)}
        </p>
      ) : state.phase === 'uploading' ? (
        <p className={`${box} border-line bg-surface text-ink`}>
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
          {td('delivery.scan.uploading', { seconds: elapsed })}
        </p>
      ) : state.phase === 'uploaded' ? (
        <p className={`${box} border-line bg-surface text-ink`}>
          {state.result.invoiceId ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <CloudUpload className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          )}
          {/* Never an internal id: an offline-queued photo says so, an upload just says it's in. */}
          {!state.result.invoiceId
            ? t('steps.scan.bannerDemo')
            : state.result.invoiceId.startsWith('queued-')
              ? t('steps.scan.bannerQueued')
              : td('delivery.scan.uploaded')}
        </p>
      ) : state.phase === 'error' ? (
        <p role="alert" className={`${box} border-danger/40 bg-surface text-danger`} data-testid="scan-error">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
