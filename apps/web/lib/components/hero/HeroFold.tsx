'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type TransitionEvent,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { motion } from '@restomatch/ui-tokens';
import { cnMerge as cn } from '../cn';
import { HERO_FOOT_LINE, HERO_FOOT_ROW } from './classes';
import { msOf } from './model';

/**
 * Whether the fold around a component is open, and whether it has been opened once (v2 A2): the
 * calculation rows inside "איך הגענו לסכום?" load on the first open and keep what they loaded.
 * Outside a fold both are true (the content is simply on the page).
 */
interface FoldState {
  open: boolean;
  opened: boolean;
}
const HeroFoldContext = createContext<FoldState>({ open: true, opened: true });
// Two @types/react copies in the workspace make a raw Context.Provider fail the JSX element check
// (STATE.md); the repo's providers cast it the same way.
const FoldProvider = HeroFoldContext.Provider as unknown as React.ComponentType<{ value: FoldState; children?: React.ReactNode }>;

/** True while the surrounding HeroFold is open (true outside a fold). */
export function useHeroFoldOpen(): boolean {
  return useContext(HeroFoldContext).open;
}

/** True once the surrounding HeroFold has been opened (true outside a fold): load on first open. */
export function useHeroFoldOpened(): boolean {
  return useContext(HeroFoldContext).opened;
}

/** React 19 `useId()` returns `«r0»` / `:r0:`-style ids; keep `[A-Za-z0-9_-]` only. */
const cleanId = (raw: string) => raw.replace(/[^A-Za-z0-9_-]/g, '');

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Fold {
  open: boolean;
  /** Opened at least once. */
  opened: boolean;
  panelId: string;
  toggle: () => void;
  /** Spread on the toggle `<button>`. */
  buttonProps: { type: 'button'; 'aria-expanded': boolean; 'aria-controls': string; onClick: () => void };
  /** Spread on the grid wrapper whose rows animate 0fr → 1fr. */
  gridProps: { className: string; onTransitionEnd: (event: TransitionEvent<HTMLDivElement>) => void };
  /** Spread on the panel, the grid's only child: inert and hidden from the accessibility tree while closed. */
  panelProps: { id: string; ref: RefObject<HTMLDivElement | null>; inert: boolean; className: string };
}

/**
 * An in-place fold that opens with grid rows 0fr → 1fr over the panel duration (SPEC §8: 240 ms,
 * the entering curve) — no measured heights, closed on the server and on the first paint (no layout
 * shift). Its own state, not the shared `useDisclosure`, which scrolls a panel that is still 0 px
 * tall (v4 H5): this one brings the panel into view after the rows finish growing, at once under
 * reduced motion. Focus stays where the caller puts it (on the toggle for the hero).
 */
export function useFold(): Fold {
  const panelId = `fold-${cleanId(useId())}`;
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const settled = useRef(true);

  const reveal = useCallback(() => {
    settled.current = true;
    panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  useEffect(() => {
    if (!open || !touched.current) return;
    if (reducedMotion()) {
      reveal();
      return;
    }
    // transitionend reveals it; a browser that cannot animate grid rows never sends one.
    settled.current = false;
    const fallback = window.setTimeout(() => {
      if (!settled.current) reveal();
    }, msOf(motion.duration.medium) + msOf(motion.duration.micro));
    return () => window.clearTimeout(fallback);
  }, [open, reveal]);

  const toggle = useCallback(() => {
    touched.current = true;
    setOpen((o) => !o);
    setOpened(true);
  }, []);

  return {
    open,
    opened,
    panelId,
    toggle,
    buttonProps: { type: 'button', 'aria-expanded': open, 'aria-controls': panelId, onClick: toggle },
    gridProps: {
      className: cn('grid transition-[grid-template-rows] duration-medium ease-enter', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'),
      onTransitionEnd: (event) => {
        if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-rows') return;
        if (open && touched.current && !settled.current) reveal();
      },
    },
    panelProps: {
      id: panelId,
      ref: panelRef,
      inert: !open,
      // Closing: the content stays visible while the rows shrink, then leaves the accessibility tree.
      className: cn('min-h-0 overflow-hidden', open ? 'visible' : 'invisible transition-[visibility] delay-[var(--dur-medium)]'),
    },
  };
}

/**
 * "איך הגענו לסכום?" (DS3 SPEC §10.1, §8): the hero's foot row — a line of context and the toggle —
 * and the calculation that opens in place under it. Below `sm` the line takes the whole row and the
 * toggle wraps to the next one, at the start (v2 C4). The panel content is passed in (server
 * rendered); a client part inside it reads `useHeroFoldOpen()` / `useHeroFoldOpened()`. No
 * `data-explain-toggle`: this is not the text-only Explain fold (W2-16 foldContract).
 */
export function HeroFold({
  line,
  label,
  testId,
  toggleTestId,
  panelLabel,
  className,
  regionClassName,
  panelClassName,
  children,
}: {
  /** The context at the start of the foot row ("35 חשבוניות נבדקו, ב־13 מהן נמצא פער"). */
  line?: React.ReactNode;
  /** The toggle's words. */
  label: string;
  /** On the fold's root. */
  testId?: string;
  /** On the toggle button. */
  toggleTestId?: string;
  /** Accessible name of the opened region. */
  panelLabel: string;
  className?: string;
  /** The animated region (e.g. negative margins so the panel bleeds to the card's edges). */
  regionClassName?: string;
  /** The panel's surface. */
  panelClassName?: string;
  children: React.ReactNode;
}) {
  const fold = useFold();
  const { ref, ...panel } = fold.panelProps;
  return (
    <div data-testid={testId} data-open={fold.open ? 'true' : 'false'} className={className}>
      <div className={HERO_FOOT_ROW}>
        {line ? <div className={HERO_FOOT_LINE}>{line}</div> : null}
        <button
          {...fold.buttonProps}
          data-testid={toggleTestId}
          className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 text-body-sm font-medium text-fg transition-colors duration-micro ease-standard hover:bg-surface-hover max-sm:-ms-2 sm:-me-2 [@media(pointer:coarse)]:min-h-11"
        >
          {label}
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform duration-short ease-standard', fold.open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      </div>
      <div {...fold.gridProps} className={cn(fold.gridProps.className, regionClassName)}>
        <div {...panel} ref={ref} role="region" aria-label={panelLabel}>
          <div className={panelClassName}>
            <FoldProvider value={{ open: fold.open, opened: fold.opened }}>{children}</FoldProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
