'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudOff, Loader2 } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import { runLogoutGuard, type LogoutChoice } from './logoutGuard';
import {
  LOGOUT_FORM_ATTR,
  clearForUser,
  countForUser,
  idbQueueStore,
  processQueue,
  queueDbExists,
} from './offlineQueue';
import { sessionScope, useQueuedPhotoUpload } from './useQueuedPhotoUpload';

/** Set on a sign-out form once the guard let it through, so the re-submit is not intercepted again. */
const PASSED_ATTR = 'data-rm-logout-passed';

type Sheet = { kind: 'flushing'; count: number } | { kind: 'ask'; count: number } | null;

/**
 * Sign-out on a shared back-door phone (mobile-field-01, auth-01 guard side).
 * Submitting a `data-rm-logout` form with this user's invoice photos still
 * queued never wipes them silently: online, they upload first; otherwise a
 * sheet names the count and offers wait / sign out and keep them on the phone
 * / delete them. Other users' queued photos are kept and attributed — they
 * upload only when their owner signs in again (keep-and-attribute; no purge at
 * sign-in). Mounted in the dashboard shell; renders nothing until needed.
 */
export function PwaSessionGuard({ userId }: { userId: string }) {
  const t = useT(receivingDelivery);
  const locale = useLocale();
  const upload = useQueuedPhotoUpload();
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  const [sheet, setSheet] = useState<Sheet>(null);
  const answerRef = useRef<((c: LogoutChoice) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form?.hasAttribute?.(LOGOUT_FORM_ATTR) || form.hasAttribute(PASSED_ATTR)) return;
      // Hold the sign-out until the queue is checked (React never sees this submit).
      e.preventDefault();
      e.stopPropagation();
      const proceed = () => {
        form.setAttribute(PASSED_ATTR, '');
        form.requestSubmit(); // dispatches synchronously
        form.removeAttribute(PASSED_ATTR);
      };
      void runLogoutGuard({
        countMine: async () => ((await queueDbExists()) ? countForUser(userId) : 0),
        online: () => navigator.onLine,
        onFlushing: (count) => setSheet({ kind: 'flushing', count }),
        flush: async () => {
          const scope = await sessionScope();
          if (scope?.userId === userId) {
            await processQueue(idbQueueStore, uploadRef.current, () => navigator.onLine, scope);
          }
          return countForUser(userId);
        },
        ask: (count) =>
          new Promise<LogoutChoice>((resolve) => {
            answerRef.current = resolve;
            setSheet({ kind: 'ask', count });
          }),
        clearMine: () => clearForUser(userId),
        proceed,
      }).finally(() => setSheet(null));
    };
    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, [userId]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d || typeof d.showModal !== 'function') return;
    if (sheet && !d.open) d.showModal();
    else if (!sheet && d.open) d.close();
  }, [sheet]);

  function answer(c: LogoutChoice) {
    answerRef.current?.(c);
    answerRef.current = null;
  }

  const count = sheet ? formatNumber(sheet.count, locale) : '';
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="rm-logout-guard-title"
      data-testid="logout-queue-sheet"
      onCancel={(e) => {
        e.preventDefault();
        if (sheet?.kind === 'ask') answer('wait');
      }}
      className="!m-auto w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-black/50"
    >
      {sheet?.kind === 'flushing' ? (
        <div role="status" className="flex items-center gap-3 p-5 text-base">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <h2 id="rm-logout-guard-title" className="font-semibold">
            {t('logoutGuard.flushing', { count })}
          </h2>
        </div>
      ) : sheet?.kind === 'ask' ? (
        <div className="space-y-3 p-5">
          <h2 id="rm-logout-guard-title" className="flex items-center gap-2 text-lg font-bold">
            <CloudOff className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            {t('logoutGuard.title', { count })}
          </h2>
          <p className="text-base text-muted">{t('logoutGuard.body')}</p>
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              autoFocus
              data-testid="logout-wait"
              onClick={() => answer('wait')}
              className="inline-flex min-h-14 items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-on-primary"
            >
              {t('logoutGuard.wait')}
            </button>
            <button
              type="button"
              data-testid="logout-keep"
              onClick={() => answer('keep')}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-base font-medium text-ink"
            >
              {t('logoutGuard.keep')}
            </button>
            <button
              type="button"
              data-testid="logout-delete"
              onClick={() => answer('delete')}
              className="inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-base font-medium text-danger underline underline-offset-4"
            >
              {t('logoutGuard.delete', { count })}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
