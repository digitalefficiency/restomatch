'use client';

import { useRef } from 'react';
import { PlayCircle, X } from 'lucide-react';

/**
 * "Watch 60 seconds" → native <dialog> with the promo video. Rendered only
 * when heroMedia.promoVideo is set. The video element is created on open
 * (nothing is downloaded until someone asks for it) and paused on close.
 */
export function PromoVideoButton({
  src,
  label,
  title,
  closeLabel,
  className,
}: {
  src: string;
  label: string;
  title: string;
  closeLabel: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          dialog.current?.showModal();
          void video.current?.play().catch(() => undefined);
        }}
      >
        <PlayCircle className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-label={title}
        onClose={() => video.current?.pause()}
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="w-[min(92vw,960px)] rounded-2xl border border-line bg-bg p-0 text-ink shadow-card backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="text-sm font-semibold">{title}</p>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={closeLabel}
            className="rounded-lg p-1.5 text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <video ref={video} src={src} controls playsInline preload="none" className="aspect-video w-full bg-black" />
      </dialog>
    </>
  );
}
