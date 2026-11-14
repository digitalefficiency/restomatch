'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, PlayCircle, X } from 'lucide-react';

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
 * "תמליל / Transcript" disclosure the video points at with aria-describedby (the list is
 * keyboard-scrollable, and runs in the other script carry their own `lang`, WCAG 3.1.2). A footer
 * that stays visible even on short laptop screens carries the real next step (the primary CTA) —
 * the film's end card has no link or URL.
 */

const FOREIGN: Record<'he' | 'en', RegExp> = {
  // Latin runs inside a Hebrew line ("Cherry tomatoes", "RestoMatch")
  he: /([A-Za-z][A-Za-z0-9’'&.\- ]*[A-Za-z0-9]|[A-Za-z])/,
  // Hebrew runs inside an English line ("עגבניות שרי")
  en: /([\u05D0-\u05EA][\u05D0-\u05EA׳״'" ]*[\u05D0-\u05EA׳״]|[\u05D0-\u05EA])/,
};
/** A transcript line with each run in the other language marked `lang` (and `dir` for Hebrew). */
function Runs({ text, lang }: { text: string; lang: 'he' | 'en' }) {
  const other = lang === 'he' ? 'en' : 'he';
  return (
    <>
      {text.split(FOREIGN[lang]).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} lang={other} dir={other === 'he' ? 'rtl' : 'ltr'}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
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
  lang,
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
  /** The page locale: the transcript's language (runs in the other script get their own `lang`). */
  lang: 'he' | 'en';
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const transcriptId = useId();
  const regionId = useId();

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
        onClose={() => {
          setOpen(false);
          setShowTranscript(false);
        }}
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="max-h-[calc(100dvh-2rem)] w-[min(92vw,960px,calc((100dvh-10rem)*16/9))] max-w-none overflow-y-auto rounded-2xl border border-line bg-bg p-0 text-ink shadow-card backdrop:bg-black/70"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg px-4 py-0.5">
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
        {/* The transcript region: always in the DOM (the video's description), shown on demand. */}
        <div id={regionId} hidden={!showTranscript} className="border-t border-line px-4 py-3 text-sm">
          <ol
            id={transcriptId}
            lang={lang}
            tabIndex={0}
            aria-label={transcriptLabel}
            className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg pe-2 text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {transcript.map((l) => (
              <li key={l.at} className="flex gap-2">
                <span className="shrink-0 font-semibold tabular-nums text-ink" dir="ltr">
                  {l.at}
                </span>
                <span>
                  <Runs text={l.text} lang={lang} />
                </span>
              </li>
            ))}
          </ol>
        </div>
        {/* sticky: the next step stays on screen even when the modal scrolls (1366×768 laptops) */}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-line bg-bg px-4 py-2">
          <button
            type="button"
            aria-expanded={showTranscript}
            aria-controls={regionId}
            onClick={() => setShowTranscript((v) => !v)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-ink hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {transcriptLabel}
            <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${showTranscript ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
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
