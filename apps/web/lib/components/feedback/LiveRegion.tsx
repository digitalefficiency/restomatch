'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type Politeness = 'polite' | 'assertive';
type Announce = (message: string, politeness?: Politeness) => void;

const AnnounceContext = createContext<Announce>(() => {});
// Cast wrapper: two @types/react majors are hoisted in the workspace (STATE.md).
const AnnounceCtxProvider = AnnounceContext.Provider as unknown as React.ComponentType<{
  value: Announce;
  children?: React.ReactNode;
}>;

/**
 * Two PERSISTENT, initially empty live regions (polite + assertive), mounted
 * once. Text written into an existing region is announced reliably; a freshly
 * mounted `role="status"` node carrying its text often is not (a11y-09).
 * `useAnnounce()` is the shared API for toasts, filter-result counts and
 * row-level outcomes.
 */
export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const frame = useRef(0);

  const announce = useCallback<Announce>((message, politeness = 'polite') => {
    const set = politeness === 'assertive' ? setAssertive : setPolite;
    // Clear first, then write on the next frame, so a repeated message is re-read.
    set('');
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => set(message));
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const value = useMemo(() => announce, [announce]);

  return (
    <AnnounceCtxProvider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-live="polite">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-live="assertive">
        {assertive}
      </div>
    </AnnounceCtxProvider>
  );
}

/** Announce a message through the persistent live regions (no-op outside the provider). */
export function useAnnounce(): Announce {
  return useContext(AnnounceContext);
}
