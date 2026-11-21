'use client';

import { useEffect, useRef } from 'react';
import { HOTKEYS, keyLabel, type HotkeyGroup } from '@/lib/hotkeys';
import { paletteCopy } from './copy';

/**
 * The `?` cheat sheet (W3-04). It renders from `HOTKEYS`, so it cannot drift
 * from what the keys do. `canGo` drops G-chords the role cannot open.
 */
export function ShortcutSheet({
  open,
  onClose,
  locale,
  canGo,
}: {
  open: boolean;
  onClose: () => void;
  locale: 'he' | 'en';
  canGo: (href: string) => boolean;
}) {
  const c = paletteCopy[locale];
  const ref = useRef<HTMLDialogElement>(null);
  const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
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
          <h2 id="rm-shortcuts-title" className="text-lg font-semibold">
            {c.cheatTitle}
          </h2>
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
