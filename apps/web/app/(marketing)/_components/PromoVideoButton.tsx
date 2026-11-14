'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { PlayCircle, X } from 'lucide-react';

/**
 * "Watch 60 seconds" → native modal <dialog> with the promo film (rendered only
 * when there is a promo). The <video> is MOUNTED only while the dialog is open:
 * nothing is requested until someone asks for it, and closing (Esc, ✕, or a
 * backdrop click) unmounts it, stopping download and playback. showModal()
 * makes the rest of the page inert (focus stays in the dialog) and returns
 * focus to the button on close. No autoplay — the viewer presses play (native
 * controls), so there is never unexpected sound or motion.
 *
 * The film is silent: its text alternative (WCAG 1.2.1) is the scene description generated from the
 * film's own copy + sample month (tools/promo/src/transcript.ts → promoTranscript.json), in a
 * "תמליל / Transcript" disclosure the video points at with aria-describedby. A persistent footer
 * carries the real next step (the primary CTA) — the film's end card has no link or URL.
 */
export function PromoVideoButton({
  src,
  poster,
  label,
  title,
  closeLabel,
  transcript,
  transcriptLabel,
  ctaHref,
  ctaLabel,
  className,
}: {
  src: string;
  poster?: string;
  label: string;
  title: string;
  closeLabel: string;
  transcript: readonly { at: string; text: string }[];
  transcriptLabel: string;
  ctaHref: string;
  ctaLabel: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const transcriptId = useId();

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
        className="w-[min(92vw,960px,calc((100dvh-6rem)*16/9))] max-w-none rounded-2xl border border-line bg-bg p-0 text-ink shadow-card backdrop:bg-black/70"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-1">
          <p className="text-sm font-semibold">{title}</p>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={closeLabel}
            className="-me-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="aspect-video w-full bg-black">
          {open ? (
            <video
              src={src}
              poster={poster}
              controls
              playsInline
              preload="metadata"
              aria-describedby={transcriptId}
              className="h-full w-full"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
          <details className="min-w-0 flex-1 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-ink">
              {transcriptLabel}
            </summary>
            <ol id={transcriptId} className="mt-1 max-h-48 space-y-1.5 overflow-y-auto pe-2 text-muted">
              {transcript.map((l) => (
                <li key={l.at} className="flex gap-2">
                  <span className="shrink-0 font-semibold tabular-nums text-ink" dir="ltr">
                    {l.at}
                  </span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ol>
          </details>
          <Link
            href={ctaHref}
            onClick={() => dialog.current?.close()}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-on-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {ctaLabel}
          </Link>
        </div>
      </dialog>
    </>
  );
}
