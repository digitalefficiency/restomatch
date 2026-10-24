'use client';

import { useEffect } from 'react';
import { LOGOUT_FORM_ATTR, clearQueue, purgeOtherUsers, queueDbExists } from './offlineQueue';

/**
 * Shared-device privacy for the receiver PWA queue (S4 cross-QA I3): queued
 * photos never outlive the session that took them.
 *  - submitting a sign-out form (`data-rm-logout`) wipes the IndexedDB queue;
 *  - when a DIFFERENT user is signed in, items of other users are dropped
 *    instead of being uploaded under this account.
 * Mounted in the dashboard shell when `receiverPwa` is on. Renders nothing.
 */
export function PwaSessionGuard({ userId }: { userId: string }) {
  useEffect(() => {
    void queueDbExists().then((exists) => (exists ? purgeOtherUsers(userId) : 0)).catch(() => null);
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLElement | null;
      if (form?.hasAttribute?.(LOGOUT_FORM_ATTR)) void clearQueue().catch(() => null);
    };
    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, [userId]);
  return null;
}
