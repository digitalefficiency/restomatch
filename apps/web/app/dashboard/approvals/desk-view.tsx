'use client';

/**
 * DS3-04 · the desk's root (spec §2.9, §4.2, §5.3): the live announcer, the queue column, the evidence and the two
 * sheets — rendered OUTSIDE both regions, so a sheet's keys never reach the desk handlers. It renders only from the
 * controller (`use-desk.ts`) and applies the controller's focus intent once per change, through one fallback chain
 * that never leaves focus on `body`. It never moves focus on mount (the page's h1 keeps it, W1-03).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import { PAGE_H1_SELECTOR } from '@/lib/nav/useRouteFocus';
import { tokenDensity } from '@/lib/prefs';
import type { DeskMode, DeskViewProps, FocusIntent } from './desk-types';
import { EvidencePanel } from './evidence';
import { QueueColumn } from './queue';
import { EscalateSheet, KeysHelp } from './sheets';
import { useDeskKeys } from './use-desk-keys';

const ROOT: Record<DeskMode, string> = {
  desk: 'group/desk flex flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row xl:gap-0 xl:overflow-hidden xl:rounded-card xl:border xl:border-line-rule xl:bg-surface xl:shadow-e1',
  single: 'group/desk flex flex-col gap-4',
};

/** A focusable element that is there and usable: connected, not disabled, not hidden by `display: none`. */
function usable(el: Element | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  return el.getClientRects().length > 0;
}

function cssId(id: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
}

/** `[data-desk-primary]` → the first enabled button of the decision bar (§5.3). */
function primaryOf(root: HTMLElement): HTMLElement | null {
  const primary = root.querySelector('[data-desk-primary]');
  if (usable(primary)) return primary;
  const bar = root.querySelector('[data-testid="decision-bar"]');
  const first = bar ? Array.from(bar.querySelectorAll('button, a[href]')).find(usable) : null;
  return first ?? null;
}

interface ResolveCtx {
  root: HTMLElement;
  wide: boolean;
  mode: DeskMode;
  currentId: string | null;
  active: Element | null;
}

/** The shared chain (R10): the current row's cell (desk, wide) → the empty panel → the evidence heading → the page h1. */
function chainOf({ root, wide, mode, currentId }: ResolveCtx): HTMLElement | null {
  if (wide && mode === 'desk' && currentId) {
    const cell = root.querySelector(`[data-row-id="${cssId(currentId)}"]`);
    if (usable(cell)) return cell;
  }
  for (const sel of ['[data-desk-empty]', '[data-desk-heading]']) {
    const el = root.querySelector(sel);
    if (usable(el)) return el;
  }
  const h1 = document.querySelector<HTMLElement>(PAGE_H1_SELECTOR);
  if (h1) {
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1'); // as RouteFocus does
    return h1;
  }
  return null;
}

/** Where one intent lands (§5.3), or the chain. `null` = leave focus where it is. */
function resolve(intent: FocusIntent, ctx: ResolveCtx): HTMLElement | null {
  const { root, wide, mode, active } = ctx;
  const inside = active instanceof HTMLElement && active.isConnected && root.contains(active);
  const first = (sel: string) => {
    const el = root.querySelector(sel);
    return usable(el) ? el : null;
  };
  switch (intent.to) {
    case 'row': {
      // Narrow and the landing have no rows: a row intent is the gap's primary.
      if (!wide || mode === 'single') return primaryOf(root) ?? chainOf(ctx);
      if (intent.onlyIfLost && inside && active !== document.body) return null;
      const row = root.querySelector(`[data-row][data-id="${cssId(intent.id)}"]`);
      // J/K pressed on a checkbox keep the column: the target row's checkbox when it is enabled (§5.2).
      if (active instanceof HTMLElement && active.matches('[data-row-check]')) {
        const check = row?.querySelector('[data-row-check]');
        if (usable(check)) return check;
      }
      const cell = row?.querySelector('[data-row-id]');
      return usable(cell) ? cell : chainOf(ctx);
    }
    case 'primary':
      return primaryOf(root) ?? chainOf(ctx);
    case 'heading':
      return first('[data-desk-heading]') ?? chainOf(ctx);
    case 'firstChip':
      return first('[data-reason-chip]') ?? primaryOf(root) ?? chainOf(ctx);
    case 'reject':
      return first('[data-testid="decide-reject"]') ?? primaryOf(root) ?? chainOf(ctx);
    case 'hide':
      return first('[data-testid="row-hide"]') ?? primaryOf(root) ?? chainOf(ctx);
    case 'empty':
      return first('[data-desk-empty]') ?? chainOf(ctx);
    case 'stay':
      return inside && usable(active) ? null : chainOf(ctx);
    case 'navFallback': {
      const pressed = first(`[data-testid="desk-${intent.from}"]`);
      if (pressed) return pressed === active ? null : pressed;
      const other = first(`[data-testid="desk-${intent.from === 'prev' ? 'next' : 'prev'}"]`);
      return other ?? chainOf(ctx);
    }
  }
}

export function DeskView({ c, doc, mode, density, singleKeys, wide, filtered, filteredNote, viewerRole }: DeskViewProps) {
  const t = useT(approvals);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const { onRowsKeyDown, onEvidenceKeyDown } = useDeskKeys(c, { mode, wide });

  // Apply the controller's focus intent once, then hand it back (§5.3). Never on mount: the first intent comes from
  // a person's action.
  const focus = c.focus;
  const { consumeFocus } = c;
  const currentId = c.current?.id ?? null;
  useLayoutEffect(() => {
    if (!focus) return;
    const root = rootRef.current;
    if (root) {
      const target = resolve(focus, { root, wide, mode, currentId, active: document.activeElement });
      if (target && target !== document.activeElement) {
        // On narrow the evidence top comes back into view after a decision (instant, §5.3); the desk's panes
        // scroll the focused row in by themselves.
        const narrow = !wide || mode === 'single';
        target.focus({ preventScroll: narrow });
        if (narrow) {
          const top = root.querySelector('[data-desk-evidence]');
          if (top instanceof HTMLElement && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
        }
      }
    }
    consumeFocus();
  }, [focus, consumeFocus, wide, mode, currentId]);

  // A `?sel=` gap opened from a link is scrolled into its pane once, without taking focus (list.tsx:535-541).
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !wide || mode !== 'desk' || !currentId) return;
    scrolledRef.current = true;
    const row = rootRef.current?.querySelector(`[data-row][data-id="${cssId(currentId)}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
  }, [wide, mode, currentId]);

  return (
    <>
      <div ref={rootRef} data-desk="" data-desk-mode={mode} data-density={tokenDensity(density)} className={ROOT[mode]}>
        <p className="sr-only" role="status" aria-live="polite" data-testid="approvals-announcer">
          {c.announcement}
        </p>
        <QueueColumn c={c} mode={mode} singleKeys={singleKeys} wide={wide} onRowsKeyDown={onRowsKeyDown} />
        <EvidencePanel
          c={c}
          doc={doc}
          mode={mode}
          density={density}
          singleKeys={singleKeys}
          wide={wide}
          filtered={filtered}
          filteredNote={filteredNote}
          onEvidenceKeyDown={onEvidenceKeyDown}
          viewerRole={viewerRole}
        />
      </div>
      {/* Outside both regions: a dialog's keys never reach the desk handlers (§4.2). */}
      <EscalateSheet
        // A fresh sheet per gap: its chips and note never carry over (list.tsx:874).
        key={c.escalateFor?.row.id ?? 'none'}
        open={c.escalateFor != null}
        t={t}
        // The controller closes the sheet as it sends (the decision is optimistic), so it is never busy while open.
        busy={false}
        onClose={() => c.closeEscalate()}
        onSend={(note) => c.escalate(note)}
      />
      <KeysHelp open={c.keysOpen} t={t} singleKeys={singleKeys} onClose={() => c.setKeysOpen(false)} />
    </>
  );
}
