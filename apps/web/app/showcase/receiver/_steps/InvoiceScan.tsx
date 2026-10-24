'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  CloudUpload,
  ImageIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useDir, useLocale, useT } from '@/lib/i18n/client';
import { receivingErrorText } from '@/app/dashboard/receiving/[poId]/_errors';
import { receiving } from '@/lib/i18n/messages/receiving';
import type { Translator } from '@/lib/i18n/translate';
import {
  ShowcaseUploadError,
  SupabaseNotConfiguredError,
  uploadInvoiceScan,
  type UploadedScan,
} from '@/lib/supabase/client';
import { prepareScanFile, ScanPrepError } from './scanPrep';
import type { CapturedImage } from '../_state';
import { StepHeader } from './SupplierSelect';

interface Props {
  supplierName: string;
  image: CapturedImage | null;
  onCapture: (image: CapturedImage) => void;
  onBack: () => void;
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
  | { phase: 'uploading'; pct: number }
  | { phase: 'uploaded'; result: CapturedImage }
  | { phase: 'error'; message: string };

export function InvoiceScan({ supplierName, image, onCapture, onBack, uploadFile, backLabel }: Props) {
  const t = useT(receiving);
  const locale = useLocale();
  const dir = useDir();
  const capturedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(image?.url ?? null);
  const [, setFilename] = useState<string | null>(image?.filename ?? null);
  const [upload, setUpload] = useState<UploadState>(
    image?.invoiceId ? { phase: 'uploaded', result: image } : { phase: 'idle' },
  );

  useGSAP(
    () => {
      gsap.from('.scan-element', {
        y: 16,
        opacity: 0,
        stagger: 0.08,
        duration: 0.5,
        ease: 'power3.out',
      });

      gsap.to('.viewfinder-corner', {
        opacity: 0.4,
        duration: 1.2,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      });
    },
    { scope: viewfinderRef },
  );

  async function handleFile(file: File) {
    // Local preview immediately for UX
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setFilename(file.name);

    // EN-2: shrink phone photos in the browser first (Vercel's 4.5 MB request
    // limit), then upload. Authenticated flow: server `scans.upload`
    // (uploadFile); anonymous showcase: the server /api/showcase/upload endpoint.
    setUpload({ phase: 'uploading', pct: 30 });
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
        setUpload({
          phase: 'uploaded',
          result: { url: localUrl, filename: file.name },
        });
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

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  function useMockImage() {
    const mockUrl =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560"><rect width="400" height="560" fill="%23f8fafc"/><rect x="40" y="40" width="320" height="40" fill="%23e2e8f0"/><rect x="40" y="100" width="200" height="20" fill="%23cbd5e1"/><rect x="40" y="130" width="160" height="20" fill="%23cbd5e1"/><line x1="40" y1="180" x2="360" y2="180" stroke="%2394a3b8" stroke-width="1"/><rect x="40" y="200" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="225" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="250" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="275" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="300" width="320" height="14" fill="%23e2e8f0"/><line x1="40" y1="340" x2="360" y2="340" stroke="%2394a3b8" stroke-width="1"/><rect x="200" y="360" width="160" height="20" fill="%231e293b"/></svg>`,
      );
    setPreviewUrl(mockUrl);
    setFilename('invoice-mock.svg');
    setUpload({
      phase: 'uploaded',
      result: { url: mockUrl, filename: 'invoice-mock.svg' },
    });
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
    setPreviewUrl(null);
    setFilename(null);
    setUpload({ phase: 'idle' });
  }

  return (
    <div dir={dir}>
      <StepHeader
        eyebrow={t('steps.stepOf', { current: 2, total: 5 })}
        title={t('steps.scan.title')}
        subtitle={t('steps.scan.subtitle', { supplier: supplierName })}
      />

      <div
        ref={viewfinderRef}
        className="relative mb-4 mx-auto max-w-md aspect-[4/5] rounded-2xl overflow-hidden border border-line bg-surface-2 shadow-card"
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed / blob URL of a private scan: next/image cannot optimize it
          <img src={previewUrl} alt={t('steps.scan.invoiceAlt')} className="scan-element absolute inset-0 w-full h-full object-contain" />
        ) : (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-subtle">
              <Camera className="scan-element w-16 h-16 mb-3" />
              <p className="scan-element text-sm">{t('steps.scan.frameHint')}</p>
            </div>
            <div className="viewfinder-corner absolute top-6 right-6 w-10 h-10 border-t-2 border-r-2 border-primary rounded-tr-lg" />
            <div className="viewfinder-corner absolute top-6 left-6 w-10 h-10 border-t-2 border-l-2 border-primary rounded-tl-lg" />
            <div className="viewfinder-corner absolute bottom-6 right-6 w-10 h-10 border-b-2 border-r-2 border-primary rounded-br-lg" />
            <div className="viewfinder-corner absolute bottom-6 left-6 w-10 h-10 border-b-2 border-l-2 border-primary rounded-bl-lg" />
          </>
        )}

        {/* Upload status badge overlaid on the viewfinder */}
        {upload.phase !== 'idle' ? (
          <div className="absolute bottom-3 inset-x-3">
            <UploadStatusBanner state={upload} t={t} />
          </div>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <div className="flex flex-col gap-3 max-w-md mx-auto mb-6">
        {previewUrl ? (
          <>
            <button
              onClick={confirmCapture}
              disabled={upload.phase !== 'uploaded'}
              className="scan-element inline-flex items-center justify-center gap-2 bg-primary hover:brightness-110 disabled:bg-surface-2 disabled:text-subtle text-on-primary min-h-12 rounded-xl px-5 py-3 font-medium shadow-glow-primary disabled:shadow-none transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
            >
              {upload.phase === 'uploading' ? t('steps.scan.uploading') : t('steps.scan.process')}
              {upload.phase === 'uploaded' ? <ArrowLeft className="w-4 h-4 ltr:-scale-x-100" aria-hidden="true" /> : null}
            </button>
            <button
              onClick={reset}
              className="scan-element inline-flex items-center justify-center gap-2 bg-surface-2 border border-line hover:border-primary/40 hover:text-primary text-ink min-h-12 rounded-xl px-5 py-3 font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <RefreshCw className="w-4 h-4" />
              {t('steps.scan.retake')}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={triggerFilePicker}
              className="scan-element inline-flex items-center justify-center gap-2 bg-primary hover:brightness-110 text-on-primary min-h-12 rounded-xl px-5 py-3 font-medium shadow-glow-primary transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary"
            >
              <Camera className="w-5 h-5" />
              {t('steps.scan.capture')}
            </button>
            <button
              onClick={useMockImage}
              className="scan-element inline-flex items-center justify-center gap-2 bg-surface-2 border border-line hover:border-primary/40 hover:text-primary text-ink min-h-12 rounded-xl px-5 py-3 font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <ImageIcon className="w-5 h-5" />
              {t('steps.scan.useDemo')}
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-ink"
      >
        <ArrowRight className="w-4 h-4 ltr:-scale-x-100" aria-hidden="true" />
        {backLabel ?? t('steps.scan.backToSupplier')}
      </button>
    </div>
  );
}

function UploadStatusBanner({
  state,
  t,
}: {
  state: UploadState;
  t: Translator<typeof receiving.he>;
}) {
  if (state.phase === 'uploading') {
    return (
      <div className="glass rounded-xl border border-primary/30 px-3 py-2 flex items-center gap-2 text-xs">
        <Loader2 className="w-4 h-4 text-primary animate-spin" />
        <span className="font-medium text-ink">{t('steps.scan.bannerUploading')}</span>
      </div>
    );
  }
  if (state.phase === 'uploaded') {
    if (state.result.invoiceId) {
      return (
        <div className="glass rounded-xl border border-primary/30 px-3 py-2 flex items-center gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink truncate">
              {t('steps.scan.bannerSaved', { id: state.result.invoiceId })}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="glass rounded-xl border border-line px-3 py-2 flex items-center gap-2 text-xs">
        <CloudUpload className="w-4 h-4 text-subtle" />
        <span className="text-muted">{t('steps.scan.bannerDemo')}</span>
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="glass rounded-xl border border-danger/30 px-3 py-2 flex items-center gap-2 text-xs">
        <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
        <span className="text-danger truncate">{state.message}</span>
      </div>
    );
  }
  return null;
}
