'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/components/cn';
import type { NavMode } from './ShellFrame';
import css from './shell.module.css';

/** Fired by the fit rule: show `text` beside `el` for a moment (sidebar spec §4.2, visible to sighted users). */
export const NAV_NOTE_EVENT = 'rm:nav-note';
export function showNavNote(el: HTMLElement, text: string, ms = 3200) {
  window.dispatchEvent(new CustomEvent(NAV_NOTE_EVENT, { detail: { el, text, ms } }));
}

interface Tip {
  el: HTMLElement;
  title: string;
  kbd?: string;
  text?: string;
  note?: boolean;
}

const HOVER_MS = 450;
const SKIP_MS = 300;
const GAP = 8;

/** The element carrying tooltip data, if this target is inside the shell. */
function tipTarget(t: EventTarget | null): HTMLElement | null {
  if (!(t instanceof Element)) return null;
  const el = t.closest<HTMLElement>('[data-tip]');
  return el && el.closest('#rm-app') ? el : null;
}

/**
 * The shell's one tooltip (sidebar spec §1.6): ink, 14/20 600 title with an LTR
 * key chip, a 12/16 meaning line. 450 ms after the pointer rests, at once while
 * moving between items (300 ms skip window) and on keyboard focus. Beside the
 * menu it sits 8 px off the rail's inline-end edge; elsewhere 8 px below the
 * trigger. It never covers its trigger, stays while hovered, and Esc closes it.
 * In the open panel only icon-only controls carry one (`data-tip-when="rail"`
 * marks tiles that show it only while the menu is collapsed).
 */
export function NavTooltip({ mode }: { mode: NavMode }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ top: number; start: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const noteTimer = useRef<number | null>(null);
  // The pointer-out grace (80 ms). Its own ref, so a new hover or a fit-rule note cancels it; and it reads the
  // tip through tipRef, never a stale closure (a note shown inside the grace would otherwise be wiped at once).
  const outTimer = useRef<number | null>(null);
  const tipRef = useRef<Tip | null>(null);
  const lastHide = useRef(0);
  const overTip = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pathname = usePathname();

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const clearOut = () => {
    if (outTimer.current !== null) window.clearTimeout(outTimer.current);
    outTimer.current = null;
  };
  const hide = useCallback(() => {
    clear();
    clearOut();
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
    noteTimer.current = null;
    setTip((cur) => {
      if (cur) lastHide.current = performance.now();
      return null;
    });
    setPos(null);
  }, []);

  const allowed = (el: HTMLElement) => {
    if (el.dataset.tipWhen !== 'rail') return true;
    const m = modeRef.current;
    return m === 'rail' || m === 'flat';
  };
  const read = (el: HTMLElement): Tip | null => {
    const title = el.dataset.tip;
    // A trigger whose own popover or flyout is open says nothing: the open list or menu is the answer, and a
    // tip would cover it (the account menu's last row, a flyout's title).
    if (!title || el.getAttribute('aria-expanded') === 'true') return null;
    return { el, title, kbd: el.dataset.tipKbd || undefined, text: el.dataset.tipText || undefined };
  };

  // A new page or a new presentation of the menu: the tip's trigger moved or went.
  useEffect(() => hide(), [pathname, mode, hide]);
  useEffect(() => {
    tipRef.current = tip;
  }, [tip]);
  useEffect(() => () => {
    clear();
    clearOut();
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
  }, []);

  useEffect(() => {
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = tipTarget(e.target);
      if (!el || !allowed(el) || el.hasAttribute('data-tip-focus-only')) return;
      // Back on a trigger inside the grace: the pending hide is moot (the next tip replaces this one).
      clearOut();
      if (tip?.el === el) return;
      clear();
      const wait = performance.now() - lastHide.current < SKIP_MS || tip ? 0 : HOVER_MS;
      timer.current = window.setTimeout(() => {
        const next = read(el);
        if (next) setTip(next);
      }, wait);
    };
    const onOut = (e: PointerEvent) => {
      const el = tipTarget(e.target);
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && (el.contains(to) || ref.current?.contains(to))) return;
      clear();
      clearOut();
      // Hoverable (WCAG 1.4.13): a short grace lets the pointer cross onto the tooltip.
      outTimer.current = window.setTimeout(() => {
        outTimer.current = null;
        if (!overTip.current && !tipRef.current?.note) hide();
      }, 80);
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tipTarget(e.target);
      if (!el || !allowed(el)) return;
      let visible = false;
      try {
        visible = el.matches(':focus-visible');
      } catch {
        visible = true;
      }
      if (!visible) return;
      clear();
      const next = read(el);
      if (next) setTip(next);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (tipTarget(e.target) && !tip?.note) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tip) {
        e.stopPropagation();
        hide();
      }
    };
    const onDown = () => {
      // A press ends any wait too: a tip timed from the hover must not appear over what the press opened.
      clear();
      if (tip && !tip.note) hide();
    };
    const onNote = (e: Event) => {
      const d = (e as CustomEvent<{ el: HTMLElement; text: string; ms: number }>).detail;
      if (!d?.el || !document.contains(d.el)) return;
      clear();
      clearOut();
      const note: Tip = { el: d.el, title: d.text, note: true };
      tipRef.current = note;
      setTip(note);
      if (noteTimer.current !== null) window.clearTimeout(noteTimer.current);
      noteTimer.current = window.setTimeout(hide, d.ms);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener(NAV_NOTE_EVENT, onNote);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener(NAV_NOTE_EVENT, onNote);
    };
    // `tip` is read through closures on purpose: re-binding keeps them current.
  }, [tip, hide]);

  // Measure at the start edge first, then place, then flip if a clamp would cover the trigger.
  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const r = tip.el.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aside = tip.el.closest('aside');
    let top: number;
    let start: number;
    if (aside) {
      const a = aside.getBoundingClientRect();
      start = (rtl ? vw - a.left : a.right) + GAP;
      top = r.top + r.height / 2 - box.height / 2;
    } else {
      const centre = r.left + r.width / 2;
      start = rtl ? vw - (centre + box.width / 2) : centre - box.width / 2;
      top = r.bottom + GAP;
      if (top + box.height > vh - GAP) top = r.top - GAP - box.height;
    }
    top = Math.max(GAP, Math.min(vh - box.height - GAP, top));
    start = Math.max(GAP, Math.min(vw - box.width - GAP, start));
    // Never over its trigger: if the clamped box intersects the trigger, move it past the trigger's far edge.
    const left = rtl ? vw - start - box.width : start;
    const overlaps = left < r.right && left + box.width > r.left && top < r.bottom && top + box.height > r.top;
    if (overlaps) top = r.bottom + GAP <= vh - box.height - GAP ? r.bottom + GAP : Math.max(GAP, r.top - GAP - box.height);
    setPos({ top: Math.round(top), start: Math.round(start) });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="nav-tooltip"
      onPointerEnter={() => {
        overTip.current = true;
      }}
      onPointerLeave={() => {
        overTip.current = false;
        if (!tip.note) hide();
      }}
      style={{ top: pos?.top ?? 0, insetInlineStart: pos?.start ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      className={cn(
        'fixed z-snackbar grid max-w-[280px] gap-px rounded-control bg-ink px-2.5 py-2 text-surface shadow-e2',
        css.tipIn,
      )}
    >
      <span className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold leading-5">
        {tip.title}
        {tip.kbd ? (
          <kbd dir="ltr" className="inline-flex h-5 items-center rounded-xs bg-surface/[0.16] px-1.5 font-sans text-xs font-medium leading-4 text-surface">
            {tip.kbd}
          </kbd>
        ) : null}
      </span>
      {tip.text ? <span className="text-xs leading-4 text-line">{tip.text}</span> : null}
    </div>
  );
}
