'use client';

import { useRef, useState } from 'react';
import { PlayCircle, X } from 'lucide-react';

/**
 * "Watch 60 seconds" → native <dialog> with the promo film (rendered only when
 * there is a promo for the viewer's locale). The <video> is MOUNTED only while
 * the dialog is open: nothing is requested until someone asks for it, and
 * closing unmounts it, which stops the download/playback. It starts playing on
 * open (the click is the user gesture), with sound and native controls.
 */
export function PromoVideoButton({
  src,
  poster,
  label,
  title,
  closeLabel,
  className,
}: {
  src: string;
  poster?: string;
  label: string;
  title: string;
  closeLabel: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <PlayCircle className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-label={title}
        onClose={() => setOpen(false)}
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
        <div className="aspect-video w-full bg-black">
          {open ? (
            <video
              src={src}
              poster={poster}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="h-full w-full"
            />
          ) : null}
        </div>
      </dialog>
    </>
  );
}
