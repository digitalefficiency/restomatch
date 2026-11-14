'use client';

import { useEffect, useRef } from 'react';
import { HOTKEYS, keyLabel, type HotkeyGroup } from '@/lib/hotkeys';
import { cn } from '@/lib/components/cn';
import { paletteCopy } from './copy';

export interface ShortcutSheetProps {
  open: boolean;
  onClose: () => void;
  locale: 'he' | 'en';
  canGo: (href: string) => boolean;
  /**
   * The "קיצורים בתו אחד" preference (sidebar spec §8: the switch lives in the
   * account menu, this sheet and the palette). Controlled: the switch renders
   * only when both this and `onSingleKeysChange` are given, so the sheet never
   * shows a switch that cannot persist.
   */
  singleKeys?: boolean;
  onSingleKeysChange?: (on: boolean) => void;
}

/**
 * The `?` cheat sheet (W3-04). It renders from `HOTKEYS`, so it cannot drift
 * from what the keys do. `canGo` drops G-chords the role cannot open. With
 * `singleKeys` + `onSingleKeysChange` it also carries the single-key switch
 * (WCAG 2.1.4): Ctrl/⌘ combinations stay on either way.
 */
export function ShortcutSheet({
  open,
  onClose,
  locale,
  canGo,
  singleKeys,
  onSingleKeysChange,
}: ShortcutSheetProps) {
  const c = paletteCopy[locale];
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start on the title, not on the first control: the switch now comes first, and a Space
      // pressed to scroll the list must not turn the single-key shortcuts off.
      titleRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  const groups: HotkeyGroup[] = ['general', 'go'];
  return (
    <dialog
      ref={ref}
      aria-labelledby="rm-shortcuts-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="fixed inset-x-0 top-[12vh] z-sheet m-0 mx-auto w-[min(520px,calc(100vw-2rem))] rounded-overlay border border-line bg-surface p-5 text-ink shadow-e3 backdrop:bg-ink/30"
    >
      {open ? (
        <>
          {/* Focused on open (tabIndex −1, no ring: it is not a control, like the page h1, spec §9). */}
          <h2
            id="rm-shortcuts-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-lg font-semibold [--focus-width:0px]"
          >
            {c.cheatTitle}
          </h2>
          {singleKeys !== undefined && onSingleKeysChange ? (
            <div className="mt-3 border-b border-line pb-3">
              <button
                type="button"
                role="switch"
                aria-checked={singleKeys}
                aria-describedby="rm-shortcuts-single-hint"
                onClick={() => onSingleKeysChange(!singleKeys)}
                className="flex min-h-10 w-full items-center justify-between gap-3 rounded-control text-start text-body-sm font-medium text-ink"
              >
                <span className="min-w-0 flex-1">{c.singleKeys}</span>
                {/* Forced colours drop both fills: the track keeps a border and the knob a solid
                    CanvasText dot, so its side still shows the state. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill transition-colors duration-micro motion-reduce:transition-none forced-colors:border',
                    singleKeys ? 'bg-primary' : 'bg-line-strong',
                  )}
                >
                  <span
                    className={cn(
                      'absolute h-4 w-4 rounded-pill bg-surface shadow-e1 transition-[inset-inline-start] duration-micro motion-reduce:transition-none forced-colors:bg-[color:CanvasText] forced-colors:forced-color-adjust-none',
                      singleKeys ? 'start-[18px]' : 'start-0.5',
                    )}
                  />
                </span>
              </button>
              <p id="rm-shortcuts-single-hint" className="text-caption text-subtle">
                {c.singleKeysHint(keyLabel('Mod', apple))}
              </p>
            </div>
          ) : null}
          {groups.map((g) => (
            <section key={g} className="mt-4">
              <h3 className="text-xs font-semibold text-subtle">{c.cheatGroups[g]}</h3>
              <dl className="mt-1 divide-y divide-line">
                {HOTKEYS.filter((h) => h.group === g && (!h.chord || canGo(h.chord.href))).map(
                  (h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <dt className="text-muted">{h.label[locale]}</dt>
                      <dd className="flex gap-1" dir="ltr">
                        {h.keys.map((k) => (
                          <kbd
                            key={k}
                            className="min-w-6 rounded border border-line bg-surface-2 px-1.5 text-center text-xs"
                          >
                            {keyLabel(k, apple)}
                          </kbd>
                        ))}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </section>
          ))}
          <button
            type="button"
            onClick={onClose}
            className="mt-4 text-sm font-medium text-ink underline"
          >
            {c.close}
          </button>
        </>
      ) : null}
    </dialog>
  );
}
