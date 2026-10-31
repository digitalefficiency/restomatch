'use client';

import { useEffect, useRef } from 'react';
import { useReauthOpen } from '@/lib/net/reauth';
import { sessionScope } from './useQueuedPhotoUpload';

/**
 * Run `onSignedIn` when W1-04's re-auth sheet closes AND a session exists
 * again — not when it was merely dismissed (then the field work stays on the
 * phone, and nothing re-opens the sheet until the next real save).
 */
export function useReauthResumed(onSignedIn: () => void): void {
  const open = useReauthOpen();
  const wasOpen = useRef(open);
  const cb = useRef(onSignedIn);
  cb.current = onSignedIn;
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    let cancelled = false;
    void sessionScope()
      .then((s) => {
        if (!cancelled && s) cb.current();
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [open]);
}
