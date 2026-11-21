'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PHONE_MEDIA, loopSourcesFor, replaceVideoSources } from '@/lib/heroMedia';

/**
 * Hero product loop (used when heroMedia.available).
 *
 * LCP: the poster is a real <img> (preloaded by the page with
 * fetchpriority=high), not the <video poster> — Chrome would otherwise count the
 * video's first frame, painted after `load`, as the LCP. The video sits exactly
 * on top at the same size and fades in on its first `playing`; a same-size later
 * paint is not a new LCP candidate; the video is also 1px smaller on each side,
 * so it can never out-rank the poster.
 * Sources are attached only after `load`, never for prefers-reduced-motion
 * (the poster stays). A pause/play toggle is shown while it plays (WCAG 2.2.2).
 *
 * `minWidth` (W3-06b): a media query below which this loop is hidden (phones
 * show HeroMatch until a 9:16 cut exists). Below it, neither the video sources
 * nor the 16:9 poster are fetched (a 1×1 data-URI <source> wins on phones).
 *
 * `phone` (W3-06b): a 9:16 cut for phones. The sources are chosen ONCE at
 * attach time (matchMedia), so a phone downloads only the 9:16 files and a
 * desktop only the 16:9 ones; the poster switches through <picture>. If the
 * video can't play (every source errors), `fallback` replaces it.
 */
/** 1×1 transparent GIF: what a hidden-below-`minWidth` poster resolves to (no network). */
const BLANK_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function HeroVideo({
  webm,
  mp4,
  poster,
  posterSrcSet,
  posterSizes,
  label,
  pauseLabel,
  playLabel,
  minWidth,
  phone = null,
  fallback,
}: {
  webm: string;
  mp4: string;
  poster: string;
  posterSrcSet?: string;
  posterSizes?: string;
  label: string;
  pauseLabel: string;
  playLabel: string;
  minWidth?: string;
  phone?: { webm: string; mp4: string; poster: string } | null;
  fallback?: ReactNode;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);

  // Primitive deps (Q3): a re-render with an equal-but-new `phone` object must not re-attach.
  const phoneWebm = phone?.webm ?? null;
  const phoneMp4 = phone?.mp4 ?? null;

  useEffect(() => {
    const v = ref.current;
    if (!v || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (minWidth && !window.matchMedia(minWidth).matches) return;
    const attach = () => {
      const phonePair = phoneWebm && phoneMp4 ? { webm: phoneWebm, mp4: phoneMp4 } : null;
      const chosen = loopSourcesFor(window.matchMedia(PHONE_MEDIA).matches, { webm, mp4 }, phonePair);
      // Q3: REPLACE the sources — a re-run (locale switch → router.refresh) must
      // never leave the old locale's <source> first in line.
      const sources = replaceVideoSources(v, [
        [chosen.webm, 'video/webm'],
        [chosen.mp4, 'video/mp4'],
      ]);
      // The last source failing means nothing can play: show the fallback.
      sources[sources.length - 1]?.addEventListener('error', () => setFailed(true), { once: true });
      v.load();
      setStarted(true);
      void v.play().catch(() => undefined);
    };
    if (document.readyState === 'complete') attach();
    else window.addEventListener('load', attach, { once: true });
    return () => window.removeEventListener('load', attach);
  }, [webm, mp4, minWidth, phoneWebm, phoneMp4]);

  if (failed && fallback) return <>{fallback}</>;

  return (
    <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 z-10 h-px flow-stream" />
      <div
        className={
          'relative w-full ' +
          (phone ? 'aspect-[9/16] max-h-[78svh] sm:aspect-video sm:max-h-none' : 'aspect-video')
        }
        data-testid="hero-video-frame"
      >
        {/* Static 1280×720 poster, preloaded with fetchpriority=high; next/image would add a hop. */}
        <picture>
          {minWidth ? <source media={`not all and ${minWidth}`} srcSet={BLANK_PIXEL} /> : null}
          {phone ? <source media={PHONE_MEDIA} srcSet={phone.poster} /> : null}
          <img
            src={poster}
            srcSet={posterSrcSet}
            sizes={posterSrcSet ? posterSizes : undefined}
            alt={label}
            width={1280}
            height={720}
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </picture>
        <video
          ref={ref}
          muted
          loop
          playsInline
          autoPlay
          preload="none"
          aria-hidden="true"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onPlaying={() => setShown(true)}
          className={
            // inset-px: strictly smaller than the poster, so the first video frame can
            // never replace it as the LCP (the 1px rim shows the poster = same frame).
            'absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] object-cover transition-opacity duration-500 ' +
            (shown ? 'opacity-100' : 'opacity-0')
          }
        />
      </div>
      {started ? (
        <button
          type="button"
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            if (v.paused) void v.play().catch(() => undefined);
            else v.pause();
          }}
          className="absolute start-3 top-3 z-10 inline-flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 gap-1 rounded-md bg-bg/80 px-2 py-1 text-xs text-muted backdrop-blur transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          {playing ? (
            <Pause className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Play className="h-3 w-3" aria-hidden="true" />
          )}
          {playing ? pauseLabel : playLabel}
        </button>
      ) : null}
    </div>
  );
}
