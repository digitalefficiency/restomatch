'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCcw } from 'lucide-react';

/** The Hebrew → English morph runs this many times, then rests on the Hebrew line (WCAG 2.2.2). */
export const MORPH_CYCLES = 3;

type MorphLine = { he: string; en: string };

/**
 * "Receiver in English" phone card on the landing page (W1-12 · mkt-15).
 * The CSS morph (`.rm-morph-*` in globals.css, motion-safe only) used to loop
 * forever with no way to stop it. Here it stops after MORPH_CYCLES and a 44 px
 * button pauses, resumes or replays it. Under reduced motion nothing animates,
 * so the button is hidden.
 */
export function ReceiverMorph({
  lines,
  originalLabel,
  englishLabel,
  labels,
}: {
  lines: readonly MorphLine[];
  originalLabel: string;
  englishLabel: string;
  labels: { pause: string; play: string; replay: string };
}) {
  const [state, setState] = useState<'playing' | 'paused' | 'ended'>('playing');
  const [run, setRun] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const total = el.querySelectorAll('.rm-morph-en').length;
    let ended = 0;
    const onEnd = (e: AnimationEvent) => {
      if ((e.target as Element).classList.contains('rm-morph-en') && ++ended >= total)
        setState('ended');
    };
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  }, [run]);

  const animStyle: React.CSSProperties = {
    animationIterationCount: MORPH_CYCLES,
    animationPlayState: state === 'paused' ? 'paused' : 'running',
  };
  const button =
    state === 'playing'
      ? { label: labels.pause, Icon: Pause, onClick: () => setState('paused') }
      : state === 'paused'
        ? { label: labels.play, Icon: Play, onClick: () => setState('playing') }
        : {
            label: labels.replay,
            Icon: RotateCcw,
            onClick: () => {
              setRun((r) => r + 1);
              setState('playing');
            },
          };

  return (
    <div className="mx-auto w-full max-w-sm rounded-[2rem] border border-line bg-bg p-3 shadow-card">
      <div className="mb-1 flex items-center justify-between gap-2 px-2">
        <div className="mx-auto h-1 w-16 rounded-full bg-line" aria-hidden="true" />
      </div>
      <div className="mb-2 flex items-center justify-between gap-2 px-2 text-xs font-semibold text-muted">
        <span>{originalLabel}</span>
        <span className="flex items-center gap-1">
          <span className="text-primary">{englishLabel}</span>
          <button
            type="button"
            onClick={button.onClick}
            aria-label={button.label}
            title={button.label}
            data-testid="morph-toggle"
            data-state={state}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:hidden"
          >
            <button.Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>
      <ul key={run} ref={listRef} className="space-y-2">
        {lines.map((l, i) => (
          <li
            key={l.en}
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3"
            style={{ '--i': i } as React.CSSProperties}
          >
            {/* Read once as a pair; the animated copies are visual only. */}
            <span className="sr-only">
              <span lang="he" dir="rtl">
                {l.he}
              </span>{' '}
              → <span lang="en">{l.en}</span>
            </span>
            <span aria-hidden="true" className="rm-morph min-w-0 text-sm font-semibold">
              <span className="rm-morph-he text-muted" lang="he" dir="rtl" style={animStyle}>
                {l.he}
              </span>
              <span className="rm-morph-en text-ink" lang="en" dir="ltr" style={animStyle}>
                {l.en}
              </span>
            </span>
            <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          </li>
        ))}
      </ul>
    </div>
  );
}
