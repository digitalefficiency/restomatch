'use client';

import { useEffect, useRef } from 'react';

/**
 * "Ctrl/⌘+S" by PHYSICAL key: on a Hebrew layout `e.key` is "ד", so matching
 * `e.key === 's'` silently fails for most of our users (catalog-40). Copied
 * from `app/dashboard/catalog/money-logic.ts` (a primitive never imports from `app/`).
 */
export function isSaveShortcut(e: { ctrlKey: boolean; metaKey: boolean; code: string; altKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyS';
}

/** Minimal key-event target (window in the app, a fake in tests). */
export interface KeyTarget {
  addEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void;
  removeEventListener(type: 'keydown', fn: (e: KeyboardEvent) => void): void;
}

/** Wire the save shortcut on `target`; the browser's "save page" dialog never opens. Returns the cleanup. */
export function attachSaveShortcut(target: KeyTarget, onSave: () => void, enabled: () => boolean = () => true): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!isSaveShortcut(e) || e.repeat) return;
    e.preventDefault();
    if (enabled()) onSave();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}

/**
 * Ctrl/⌘+S saves (any keyboard layout). `onSave` may change every render; the
 * latest one runs. With `enabled: false` the shortcut is still swallowed (no
 * "save page as…" dialog) but does nothing.
 */
export function useSaveShortcut(onSave: () => void, { enabled = true }: { enabled?: boolean } = {}): void {
  const latest = useRef(onSave);
  latest.current = onSave;
  const on = useRef(enabled);
  on.current = enabled;
  useEffect(() => attachSaveShortcut(window, () => latest.current(), () => on.current), []);
}
