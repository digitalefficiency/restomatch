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
import {
  SupabaseNotConfiguredError,
  uploadInvoiceScan,
} from '@/lib/supabase/client';
import type { CapturedImage } from '../_state';
import { StepHeader } from './SupplierSelect';

interface Props {
  supplierName: string;
  image: CapturedImage | null;
  onCapture: (image: CapturedImage) => void;
  onBack: () => void;
}

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; pct: number }
  | { phase: 'uploaded'; result: CapturedImage }
  | { phase: 'error'; message: string };

export function InvoiceScan({ supplierName, image, onCapture, onBack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(image?.url ?? null);
  const [filename, setFilename] = useState<string | null>(image?.filename ?? null);
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

    // Real upload to Supabase Storage in the background
    setUpload({ phase: 'uploading', pct: 30 });
    try {
      const uploaded = await uploadInvoiceScan(file, { supplierName });
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
        setUpload({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
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
    onCapture(upload.result);
  }

  function reset() {
    setPreviewUrl(null);
    setFilename(null);
    setUpload({ phase: 'idle' });
  }

  return (
    <div dir="rtl">
      <StepHeader
        eyebrow="צעד 2 מתוך 5"
        title="צלם את החשבונית"
        subtitle={`מהספק "${supplierName}". וודא שכל פריטי השורה נראים בבירור.`}
      />

      <div
        ref={viewfinderRef}
        className="relative mb-4 mx-auto max-w-md aspect-[4/5] rounded-2xl overflow-hidden border border-stone-200 bg-gradient-to-br from-stone-50 to-stone-100 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-12px_rgba(15,23,42,0.12)]"
      >
        {previewUrl ? (
          <img src={previewUrl} alt="חשבונית" className="scan-element absolute inset-0 w-full h-full object-contain" />
        ) : (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-400">
              <Camera className="scan-element w-16 h-16 mb-3" />
              <p className="scan-element text-sm">המסגרת מציינת איפה למקם את החשבונית</p>
            </div>
            <div className="viewfinder-corner absolute top-6 right-6 w-10 h-10 border-t-2 border-r-2 border-teal-500 rounded-tr-lg" />
            <div className="viewfinder-corner absolute top-6 left-6 w-10 h-10 border-t-2 border-l-2 border-teal-500 rounded-tl-lg" />
            <div className="viewfinder-corner absolute bottom-6 right-6 w-10 h-10 border-b-2 border-r-2 border-teal-500 rounded-br-lg" />
            <div className="viewfinder-corner absolute bottom-6 left-6 w-10 h-10 border-b-2 border-l-2 border-teal-500 rounded-bl-lg" />
          </>
        )}

        {/* Upload status badge overlaid on the viewfinder */}
        {upload.phase !== 'idle' ? (
          <div className="absolute bottom-3 right-3 left-3">
            <UploadStatusBanner state={upload} />
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
              className="scan-element inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-stone-200 disabled:text-stone-400 text-white rounded-xl px-5 py-3 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.3)] disabled:shadow-none transition-all"
            >
              {upload.phase === 'uploading' ? 'מעלה לשרת...' : 'עבד את החשבונית'}
              {upload.phase === 'uploaded' ? <ArrowLeft className="w-4 h-4" /> : null}
            </button>
            <button
              onClick={reset}
              className="scan-element inline-flex items-center justify-center gap-2 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-xl px-5 py-3 font-medium transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              צלם מחדש
            </button>
          </>
        ) : (
          <>
            <button
              onClick={triggerFilePicker}
              className="scan-element inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl px-5 py-3 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.3)] transition-all"
            >
              <Camera className="w-5 h-5" />
              צלם / העלה קובץ
            </button>
            <button
              onClick={useMockImage}
              className="scan-element inline-flex items-center justify-center gap-2 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 rounded-xl px-5 py-3 font-medium transition-all"
            >
              <ImageIcon className="w-5 h-5" />
              השתמש בחשבונית-דמה (ללא העלאה)
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800"
      >
        <ArrowRight className="w-4 h-4" />
        חזור לבחירת ספק
      </button>
    </div>
  );
}

function UploadStatusBanner({ state }: { state: UploadState }) {
  if (state.phase === 'uploading') {
    return (
      <div className="rounded-xl bg-white/95 backdrop-blur-md border border-teal-200 px-3 py-2 shadow-sm flex items-center gap-2 text-xs">
        <Loader2 className="w-4 h-4 text-teal-600 animate-spin" />
        <span className="font-medium text-stone-800">מעלה ל-Supabase Storage...</span>
      </div>
    );
  }
  if (state.phase === 'uploaded') {
    if (state.result.invoiceId) {
      return (
        <div className="rounded-xl bg-emerald-50/95 backdrop-blur-md border border-emerald-200 px-3 py-2 shadow-sm flex items-center gap-2 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-emerald-900 truncate">
              נשמר ב-Supabase · {state.result.invoiceId}
            </div>
            <div className="text-emerald-700/80 truncate text-[10px]">
              {state.result.publicUrl}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl bg-stone-50/95 backdrop-blur-md border border-stone-200 px-3 py-2 shadow-sm flex items-center gap-2 text-xs">
        <CloudUpload className="w-4 h-4 text-stone-500" />
        <span className="text-stone-700">מצב הדגמה — לא נשמר בשרת</span>
      </div>
    );
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-xl bg-red-50/95 backdrop-blur-md border border-red-200 px-3 py-2 shadow-sm flex items-center gap-2 text-xs">
        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
        <span className="text-red-800 truncate">{state.message}</span>
      </div>
    );
  }
  return null;
}
