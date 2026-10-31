'use client';

import { useCallback, useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc/client';
import { requestReauth } from '@/lib/net/reauth';
import {
  FIELD_DB_NAMES,
  GR_LINE_KIND,
  LEGACY_LINES_PREFIX,
  PHOTO_KIND,
  dropLegacyLine,
  ensurePhotosMigrated,
  migrateLegacyLines,
} from './fieldOutbox';
import type { GrLinePayload } from './lineOutbox';
import { withoutStamp } from './lineOutbox';
import type { QueuedPhoto } from './offlineQueue';
import {
  OUTBOX_EVENT,
  OutboxHeldError,
  drainOutbox,
  idbOutboxStore,
  nextDueAt,
  outboxDbExists,
  registerOutboxKind,
  sweepExpired,
  type DrainResult,
  type OutboxEventDetail,
} from './outbox';
import { useQueuedPhotoUpload, sessionScope } from './useQueuedPhotoUpload';
import { useReauthResumed } from './useReauthResumed';

/** Fired with each drain's result so the receiving chip can show "uploaded · taken by …". */
export const DRAINED_EVENT = 'rm-outbox-drained';

const OFFLINE_RECHECK_MS = 30_000;
const HELD_RECHECK_MS = 15_000;

/** The page's drainer (one per page: the dashboard shell mounts it). */
let current: (() => Promise<DrainResult | null>) | null = null;

/** Drain now (the chip's "try again", the receiving shell's back-online). Null when no drainer is mounted or nothing ran. */
export function drainNow(): Promise<DrainResult | null> {
  return current ? current() : Promise.resolve(null);
}

function hasLegacyLines(): boolean {
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      if (window.localStorage.key(i)?.startsWith(LEGACY_LINES_PREFIX)) return true;
    }
  } catch {
    /* storage blocked */
  }
  return false;
}

/**
 * The background drainer of the field outbox: binds the receiving kinds to
 * tRPC and sends whatever waits — on mount, back online, after a sign-in, on
 * every outbox write and when the next backoff is due. It touches IndexedDB
 * only when a field database (or a W1-06 line row) already exists, so a page
 * of a user who never worked offline costs nothing.
 */
export function useOutboxDrainer(userId: string): void {
  const utils = trpc.useUtils();
  const uploadPhoto = useQueuedPhotoUpload();
  const running = useRef<Promise<DrainResult | null> | null>(null);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authHeld = useRef(false);

  // The senders. A grLine counted before its receipt was closed / reopened is
  // HELD (parked), never replayed over the count the match was made against.
  useEffect(() => {
    const offLine = registerOutboxKind<GrLinePayload>('grLine', {
      ...GR_LINE_KIND,
      async send(row, item) {
        if (!row.stamp) throw new OutboxHeldError('row has no receipt stamp');
        const receipt = await utils.client.receiving.getReceipt.query({ grId: row.stamp.grId });
        const version = receipt.updatedAt ? new Date(receipt.updatedAt).toISOString() : null;
        if (receipt.status !== 'pending' || version !== row.stamp.version) {
          throw new OutboxHeldError('receipt closed or reopened since this line was counted');
        }
        await utils.client.receiving.markGrLine.mutate(withoutStamp(row));
        dropLegacyLine(item.meta?.legacyKey, row);
      },
    });
    const offPhoto = registerOutboxKind<QueuedPhoto>('photo', {
      ...PHOTO_KIND,
      send: (p, item) => uploadPhoto({ ...p, attempts: item.attempts, lastError: item.lastError }),
    });
    // submitReceipt / slipShared bind with their server procedures (slices B/C); until then their items wait.
    return () => {
      offLine();
      offPhoto();
    };
  }, [utils, uploadPhoto]);

  const drain = useCallback(async (): Promise<DrainResult | null> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async (): Promise<DrainResult | null> => {
      if (authHeld.current || !navigator.onLine) return null;
      if (!(await outboxDbExists(FIELD_DB_NAMES)) && !hasLegacyLines()) return null;
      const scope = await sessionScope().catch(() => null);
      if (!scope || scope.userId !== userId) return null;
      await ensurePhotosMigrated();
      await migrateLegacyLines(scope);
      await sweepExpired(idbOutboxStore);
      const result = await drainOutbox(idbOutboxStore, { scope });
      if (result.authExpired) {
        authHeld.current = true; // no loop of 401s: wait for the sign-in
        requestReauth();
      }
      window.dispatchEvent(new CustomEvent<DrainResult>(DRAINED_EVENT, { detail: result }));
      // Wake up when the next backoff is due.
      const due = nextDueAt(await idbOutboxStore.list(), scope);
      if (timer.current) clearTimeout(timer.current);
      if (result.offline && result.remaining > 0) {
        // "Online" but nothing answers (a captive Wi-Fi): look again in a while, besides the `online` event.
        timer.current = setTimeout(() => void drain(), OFFLINE_RECHECK_MS);
      } else if (due !== null && !result.authExpired) {
        // Already due but not sent (its group is held by an open screen / another tab): look again later.
        const wait = due <= Date.now() ? HELD_RECHECK_MS : Math.max(1_000, due - Date.now());
        timer.current = setTimeout(() => void drain(), wait);
      }
      return result;
    })().catch(() => null);
    running.current = run;
    try {
      return await run;
    } finally {
      running.current = null;
      if (again.current) {
        again.current = false;
        void drain();
      }
    }
  }, [userId]);

  useReauthResumed(() => {
    authHeld.current = false;
    void drain();
  });

  useEffect(() => {
    current = drain;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const soon = (e: Event) => {
      if ((e as CustomEvent<OutboxEventDetail | undefined>).detail?.source === 'drain') return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void drain(), 500);
    };
    const onOnline = () => void drain();
    window.addEventListener('online', onOnline);
    window.addEventListener(OUTBOX_EVENT, soon);
    void drain();
    return () => {
      if (current === drain) current = null;
      window.removeEventListener('online', onOnline);
      window.removeEventListener(OUTBOX_EVENT, soon);
      if (debounce) clearTimeout(debounce);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [drain]);
}
