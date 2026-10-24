'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
 */
export function HeroVideo({
  webm,
  mp4,
  poster,
  posterSrcSet,
  posterSizes,
  label,
  pauseLabel,
  playLabel,
}: {
  webm: string;
  mp4: string;
  poster: string;
  posterSrcSet?: string;
  posterSizes?: string;
  label: string;
  pauseLabel: string;
  playLabel: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const attach = () => {
      for (const [src, type] of [
        [webm, 'video/webm'],
        [mp4, 'video/mp4'],
      ] as const) {
        const s = document.createElement('source');
        s.src = src;
        s.type = type;
        v.appendChild(s);
      }
      v.load();
      setStarted(true);
      void v.play().catch(() => undefined);
    };
    if (document.readyState === 'complete') attach();
    else window.addEventListener('load', attach, { once: true });
    return () => window.removeEventListener('load', attach);
  }, [webm, mp4]);

  return (
    <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-surface shadow-card">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 z-10 h-px flow-stream" />
      <div className="relative aspect-video w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- static 1280×720 poster, preloaded with fetchpriority=high; next/image would add a hop */}
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
          className="absolute left-3 top-3 z-10 inline-flex min-h-8 items-center gap-1 rounded-md bg-bg/80 px-2 py-1 text-[11px] text-muted backdrop-blur transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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
