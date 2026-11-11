'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

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

  // A message belongs to the page it was announced on: clear both regions on
  // navigation, so an old error is not still sitting in role="alert" later.
  // Mounting is not a navigation: this effect runs after the children's, so on
  // the first run it would cancel a toast fired from a mount effect (the
  // branch-switch notice after its full reload) before it is ever read out.
  const pathname = usePathname();
  const announcedOn = useRef(pathname);
  useEffect(() => {
    if (announcedOn.current === pathname) return;
    announcedOn.current = pathname;
    cancelAnimationFrame(frame.current);
    setPolite('');
    setAssertive('');
  }, [pathname]);
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
