'use client';

import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ArrowLeft, ArrowRight, Camera, ImageIcon, RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CapturedImage } from '../_state';
import { StepHeader } from './SupplierSelect';

interface Props {
  supplierName: string;
  image: CapturedImage | null;
  onCapture: (image: CapturedImage) => void;
  onBack: () => void;
}

export function InvoiceScan({ supplierName, image, onCapture, onBack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(image?.url ?? null);
  const [filename, setFilename] = useState<string | null>(image?.filename ?? null);

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

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setFilename(file.name);
  }

  function triggerFilePicker() {
    fileInputRef.current?.click();
  }

  function useMockImage() {
    // Showcase fallback: pretend we captured something
    const mockUrl =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560"><rect width="400" height="560" fill="%23f8fafc"/><rect x="40" y="40" width="320" height="40" fill="%23e2e8f0"/><rect x="40" y="100" width="200" height="20" fill="%23cbd5e1"/><rect x="40" y="130" width="160" height="20" fill="%23cbd5e1"/><line x1="40" y1="180" x2="360" y2="180" stroke="%2394a3b8" stroke-width="1"/><rect x="40" y="200" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="225" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="250" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="275" width="320" height="14" fill="%23e2e8f0"/><rect x="40" y="300" width="320" height="14" fill="%23e2e8f0"/><line x1="40" y1="340" x2="360" y2="340" stroke="%2394a3b8" stroke-width="1"/><rect x="200" y="360" width="160" height="20" fill="%231e293b"/></svg>`,
      );
    setPreviewUrl(mockUrl);
    setFilename('invoice-mock.svg');
  }

  function confirmCapture() {
    if (!previewUrl || !filename) return;
    onCapture({ url: previewUrl, filename });
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
        className="relative mb-6 mx-auto max-w-md aspect-[4/5] rounded-2xl overflow-hidden border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-12px_rgba(15,23,42,0.12)]"
      >
        {previewUrl ? (
          <img src={previewUrl} alt="חשבונית" className="scan-element absolute inset-0 w-full h-full object-contain" />
        ) : (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
              <Camera className="scan-element w-16 h-16 mb-3" />
              <p className="scan-element text-sm">המסגרת מציינת איפה למקם את החשבונית</p>
            </div>
            {/* Viewfinder corners */}
            <div className="viewfinder-corner absolute top-6 right-6 w-10 h-10 border-t-2 border-r-2 border-blue-500 rounded-tr-lg" />
            <div className="viewfinder-corner absolute top-6 left-6 w-10 h-10 border-t-2 border-l-2 border-blue-500 rounded-tl-lg" />
            <div className="viewfinder-corner absolute bottom-6 right-6 w-10 h-10 border-b-2 border-r-2 border-blue-500 rounded-br-lg" />
            <div className="viewfinder-corner absolute bottom-6 left-6 w-10 h-10 border-b-2 border-l-2 border-blue-500 rounded-bl-lg" />
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <div className="flex flex-col gap-3 max-w-md mx-auto mb-8">
        {previewUrl ? (
          <>
            <button
              onClick={confirmCapture}
              className="scan-element inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-3 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.3)] transition-all"
            >
              עבד את החשבונית
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setPreviewUrl(null);
                setFilename(null);
              }}
              className="scan-element inline-flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl px-5 py-3 font-medium transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              צלם מחדש
            </button>
          </>
        ) : (
          <>
            <button
              onClick={triggerFilePicker}
              className="scan-element inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-5 py-3 font-medium shadow-[0_4px_12px_rgba(37,99,235,0.3)] transition-all"
            >
              <Camera className="w-5 h-5" />
              צלם / העלה קובץ
            </button>
            <button
              onClick={useMockImage}
              className="scan-element inline-flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl px-5 py-3 font-medium transition-all"
            >
              <ImageIcon className="w-5 h-5" />
              השתמש בחשבונית-דמה (להדגמה)
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowRight className="w-4 h-4" />
        חזור לבחירת ספק
      </button>
    </div>
  );
}
