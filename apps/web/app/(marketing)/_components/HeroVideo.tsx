'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Hero product loop (used when heroMedia.available). The poster is the LCP
 * element and paints immediately; the video sources are attached only after
 * the page has loaded, and never for prefers-reduced-motion (poster stays).
 * A pause/play toggle is shown while it plays (WCAG 2.2.2 — moving content).
 */
export function HeroVideo({
  webm,
  mp4,
  poster,
  label,
  pauseLabel,
  playLabel,
}: {
  webm: string;
  mp4: string;
  poster: string;
  label: string;
  pauseLabel: string;
  playLabel: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);

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
      <video
        ref={ref}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay
        preload="none"
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="aspect-[4/3] w-full object-cover"
      />
      {started ? (
        <button
          type="button"
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            if (v.paused) void v.play().catch(() => undefined);
            else v.pause();
          }}
          className="absolute bottom-3 end-3 z-10 inline-flex min-h-8 items-center gap-1 rounded-md bg-bg/80 px-2 py-1 text-[11px] text-muted backdrop-blur transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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
