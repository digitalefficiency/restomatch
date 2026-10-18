'use client';

import { useEffect } from 'react';
import { clearQueue, queueDbExists } from './offlineQueue';

/**
 * Mounted on /login: whoever lands on the sign-in page — after signing out or
 * after a session-expired redirect — starts with an empty receiver photo queue
 * on this device (S4 cross-QA I3, shared tablets). Touches IndexedDB only if
 * the receiver queue already exists. Renders nothing.
 */
export function PwaQueueReset() {
  useEffect(() => {
    void queueDbExists()
      .then((exists) => (exists ? clearQueue() : undefined))
      .catch(() => null);
  }, []);
  return null;
}
