'use client';

import { CloudUpload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { idbQueueStore, queueDbExists, QUEUE_EVENT } from '@/lib/pwa/offlineQueue';

/**
 * auth-01: the sign-in page never touches the receiver's offline photo queue —
 * it only READS how many photos wait on this device and says so (T4 neutral).
 * Photos upload only under the user who took them (a different user's sign-in
 * drops them — PwaSessionGuard), so the note never invites just anyone to send them. Shared-device
 * privacy stays with PwaSessionGuard: other users' items are dropped at the next
 * sign-in, and an explicit sign-out still clears the queue.
 */
// TODO(W2-05): read the count via W1-06's pendingCountOnDevice() once wave 2 adopts it.
export function QueuedPhotosNote() {
  const t = useT(authMessages);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void queueDbExists()
        .then((exists) => (exists ? idbQueueStore.list() : []))
        .then((items) => alive && setCount(items.length))
        .catch(() => null);
    read();
    window.addEventListener(QUEUE_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(QUEUE_EVENT, read);
    };
  }, []);
  if (count === 0) return null;
  return (
    <p
      role="status"
      data-testid="queued-photos-note"
      className="mb-4 flex items-start gap-2 rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink"
    >
      <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      <span>{count === 1 ? t('signin.queuedOne') : t('signin.queuedMany', { count })}</span>
    </p>
  );
}
