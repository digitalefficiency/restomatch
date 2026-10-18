'use client';

import { useEffect, useRef } from 'react';

/**
 * Hero product loop (used when heroMedia.available). The poster is the LCP
 * element and paints immediately; the video sources are attached only after
 * the page has loaded, and never for prefers-reduced-motion (poster stays).
 */
export function HeroVideo({
  webm,
  mp4,
  poster,
  label,
}: {
  webm: string;
  mp4: string;
  poster: string;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

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
        className="aspect-[4/3] w-full object-cover"
      />
    </div>
  );
}
