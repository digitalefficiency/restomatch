'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The side menu's collapsed/expanded state, read from and set through the shell
 * that owns it (app/dashboard/nav.tsx ShellFrame, DS3-02): its frame carries
 * `#rm-app[data-rail]`, and Ctrl/⌘+B toggles it (and writes its cookie,
 * lib/nav/prefs.ts). Settings never writes the rail cookie itself.
 * Request to DS3-02: export a rail setter so this stops synthesising the key.
 */
export function useShellRail(initial: boolean) {
  const [rail, setRail] = useState(initial);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const el = document.getElementById('rm-app');
    if (!el || !('rail' in el.dataset)) {
      setAvailable(false);
      return;
    }
    const read = () => setRail(el.dataset.rail === 'on');
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ['data-rail'] });
    return () => observer.disconnect();
  }, []);

  const set = useCallback((next: boolean) => {
    const el = document.getElementById('rm-app');
    if (!el || (el.dataset.rail === 'on') === next) return;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
  }, []);

  return useMemo(() => ({ rail, available, setRail: set }), [rail, available, set]);
}
