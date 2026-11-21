'use client';

import { useState } from 'react';
import { ExternalLink, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '../cn';

export interface ScanViewerCopy {
  title: string;
  zoomIn: string;
  zoomOut: string;
  rotate: string;
  zoom: (pct: number) => string;
  openOriginal: string;
  noDoc: string;
}

const MIN = 50;
const MAX = 400;
const STEP = 25;
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info';
const TOOL = cn(
  'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink hover:bg-surface-2 disabled:opacity-50',
  FOCUS,
);

/**
 * W2-02 · the original document at the cockpit's start edge (ported from the
 * showcase InvoiceScanViewer, real signed URL instead of a mock paper). Image:
 * zoom 50–400 % and rotate. PDF: a sandboxed iframe (the browser's own pager).
 * The URL is short-lived and never stored.
 */
export function InvoiceScanViewer({
  src,
  mimeType,
  copy,
  className,
}: {
  src: string | null;
  mimeType: string | null;
  copy: ScanViewerCopy;
  className?: string;
}) {
  const [zoom, setZoom] = useState(100);
  const [turn, setTurn] = useState(0);
  if (!src) {
    return (
      <div className={cn('flex min-h-48 items-center justify-center rounded-2xl border border-line bg-surface-2 p-6', className)}>
        <p className="text-sm text-muted">{copy.noDoc}</p>
      </div>
    );
  }
  const pdf = mimeType === 'application/pdf';
  return (
    <section
      aria-label={copy.title}
      data-testid="scan-viewer"
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card', className)}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 p-2">
        {pdf ? null : (
          <>
            <button type="button" className={TOOL} aria-label={copy.zoomOut} disabled={zoom <= MIN} onClick={() => setZoom((z) => Math.max(MIN, z - STEP))}>
              <ZoomOut className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="min-w-16 text-center text-sm text-ink" aria-live="polite" data-testid="scan-zoom">
              {copy.zoom(zoom)}
            </span>
            <button type="button" className={TOOL} aria-label={copy.zoomIn} disabled={zoom >= MAX} onClick={() => setZoom((z) => Math.min(MAX, z + STEP))}>
              <ZoomIn className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className={TOOL} aria-label={copy.rotate} onClick={() => setTurn((r) => (r + 90) % 360)}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('ms-auto inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary underline-offset-4 hover:underline', FOCUS)}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {copy.openOriginal}
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-2">
        {pdf ? (
          <iframe src={src} title={copy.title} sandbox="allow-same-origin" className="h-[70dvh] w-full border-0" />
        ) : (
          <div className="flex min-h-full items-start justify-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL of a private scan */}
            <img
              src={src}
              alt={copy.title}
              className="max-w-none origin-top transition-transform"
              style={{ width: `${zoom}%`, transform: `rotate(${turn}deg)` }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
