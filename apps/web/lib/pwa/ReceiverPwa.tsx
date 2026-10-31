'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff, Download, Loader2, UploadCloud } from 'lucide-react';
import { claimOfflineChip } from '@/lib/net/offlineChipOwner';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { ingest } from '@/lib/i18n/messages/ingest';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';
import { ensurePhotosMigrated } from './fieldOutbox';
import { refreshFieldSnapshot } from './fieldSnapshot';
import { QUEUE_EVENT, idbAvailable, queueDbExists } from './offlineQueue';
import { OUTBOX_EVENT, countOutbox, idbOutboxStore, type DrainResult, type OutboxItem } from './outbox';
import { OutboxStatusSheet } from './OutboxStatusSheet';
import { DRAINED_EVENT, drainNow } from './useOutboxDrainer';
import { useReauthResumed } from './useReauthResumed';

export { blobToBase64 } from './useQueuedPhotoUpload';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

/** "Syncing" shows only when it lasts longer than this — a fast sync never flashes (perf-states-05). */
export const SYNC_CHIP_DELAY_MS = 400;

/** How long "uploaded · taken by …" stays up. */
const ATTRIBUTION_MS = 8_000;

/** The read snapshot of today's deliveries is refreshed at most this often per tab. */
const SNAPSHOT_EVERY_MS = 5 * 60_000;
const SNAPSHOT_STAMP = 'rm-rcv-snapshot-at';

/**
 * Large-touch-target "installed" mode: only when launched from the home screen
 * (display-mode: standalone, or the manifest's ?source=pwa start URL).
 */
const INSTALLED_CSS = `
html[data-pwa='installed'] main button,
html[data-pwa='installed'] main a,
html[data-pwa='installed'] main input,
html[data-pwa='installed'] main select { min-height: 56px; }
html[data-pwa='installed'] main button { font-size: 1.0625rem; }
html[data-pwa='installed'] body { overscroll-behavior-y: contain; }
`;

/**
 * Receiver PWA shell (flag `receiverPwa`), mounted on the receiving pages:
 * manifest + theme links, service-worker registration (scope
 * /dashboard/receiving), the offline photo queue uploader and the install
 * prompt. Its state is ONE fixed chip under the header (mobile-field
 * §3.7) — it never sits in the content flow, so it can't push the delivery
 * cards under the receiver's thumb (CLS). Offline is neutral (T4), never a
 * warning. Renders nothing while online with an empty queue. A colleague's
 * photo of this branch (shared tablet) uploads too, and the chip says who took
 * it ("צולם על ידי", decision 22 default).
 */
export function ReceiverPwa({
  restaurantId,
  userId,
  snapshotPaths,
}: {
  restaurantId: string;
  userId: string;
  /** Pages to keep readable offline (the board and today's open POs); refreshed while online. */
  snapshotPaths?: string[];
}) {
  const t = useT(ingest);
  const tr = useT(receivingDelivery);
  const locale = useLocale();
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [photosOnly, setPhotosOnly] = useState(true);
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [statusOpen, setStatusOpen] = useState(false);
  const [others, setOthers] = useState(0);
  const [syncingShown, setSyncingShown] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [attributed, setAttributed] = useState<DrainResult['attributed']>([]);
  // The session expired: queued photos wait for a sign-in (no auto-sync that would re-open the sheet).
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const needsSignInRef = useRef(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const running = useRef(false);
  // Only invoice photos waiting: the W1 wording; otherwise "⟳ 3 waiting" (counts, closes, photos).
  const queuedText = photosOnly
    ? queued === 1
      ? t('pwa.queuedOne')
      : t('pwa.queued', { count: formatNumber(queued, locale) })
    : tr('pwa.waiting', { count: formatNumber(queued, locale) });

  // This branch's work — the colleague's too — goes here; another branch's waits for it.
  const ofBranch = useCallback((i: { restaurantId: string }) => i.restaurantId === restaurantId, [restaurantId]);

  const refreshCount = useCallback(async () => {
    if (!idbAvailable()) return;
    try {
      if (!(await queueDbExists())) return;
      await ensurePhotosMigrated();
      const all = await idbOutboxStore.list();
      const c = countOutbox(all, { restaurantId, userId });
      const mine = all.filter(ofBranch);
      setItems(mine);
      setQueued(c.waiting);
      setPhotosOnly(mine.every((i) => i.kind === 'photo'));
      setOthers(c.otherBranch);
    } catch {
      /* private mode without IndexedDB */
    }
  }, [ofBranch, restaurantId, userId]);

  /** The dashboard shell's drainer sends; this chip only shows what happened. */
  const onDrained = useCallback((r: DrainResult) => {
    setSyncError(r.failed.length > 0 && !r.offline && !r.authExpired);
    if (r.attributed.length > 0) setAttributed(r.attributed);
    if (r.authExpired) {
      // Signed out (W1-04): the drainer opened the re-auth sheet; "sign in to upload" — never "sync failed".
      needsSignInRef.current = true;
      setNeedsSignIn(true);
      setSyncError(false);
    }
    void refreshCount();
  }, [refreshCount]);

  const sync = useCallback(async () => {
    if (running.current || needsSignInRef.current || !idbAvailable() || !navigator.onLine) return;
    running.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      // Nothing of this branch waiting: no sync, no chip, no layout work at all.
      if (!(await queueDbExists())) return;
      await ensurePhotosMigrated();
      if ((await idbOutboxStore.list()).filter(ofBranch).length === 0) return;
      timer = setTimeout(() => setSyncingShown(true), SYNC_CHIP_DELAY_MS);
      await drainNow(); // the result arrives through DRAINED_EVENT
    } catch {
      setSyncError(true);
    } finally {
      if (timer) clearTimeout(timer);
      running.current = false;
      setSyncingShown(false);
    }
  }, [ofBranch]);

  // Keep today's deliveries readable offline (zero bars at the back door).
  const snapshotKey = (snapshotPaths ?? []).join('|');
  useEffect(() => {
    if (!snapshotKey || !navigator.onLine) return;
    try {
      const last = Number(sessionStorage.getItem(SNAPSHOT_STAMP) ?? 0);
      if (Date.now() - last < SNAPSHOT_EVERY_MS) return;
      sessionStorage.setItem(SNAPSHOT_STAMP, String(Date.now()));
    } catch {
      /* storage blocked: refresh anyway */
    }
    const id = setTimeout(() => void refreshFieldSnapshot({ userId, restaurantId }, snapshotKey.split('|')), 3_000);
    return () => clearTimeout(id);
  }, [snapshotKey, userId, restaurantId]);

  // Signed in again: upload what waited.
  useReauthResumed(() => {
    needsSignInRef.current = false;
    setNeedsSignIn(false);
    void sync();
  });

  useEffect(() => {
    if (attributed.length === 0) return;
    const id = setTimeout(() => setAttributed([]), ATTRIBUTION_MS);
    return () => clearTimeout(id);
  }, [attributed]);

  const names = [...new Set(attributed.map((a) => a.capturedByName ?? tr('pwa.someoneElse')))].join(', ');

  // This chip (offline + queued-photo count) is the one offline indicator on
  // receiving routes; the shell's generic chip yields while it is mounted.
  useEffect(() => claimOfflineChip(), []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      new URLSearchParams(window.location.search).get('source') === 'pwa' ||
      sessionStorage.getItem('rm-pwa') === '1';
    if (standalone) {
      sessionStorage.setItem('rm-pwa', '1');
      document.documentElement.dataset.pwa = 'installed';
      setInstalled(true);
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/receiver-sw.js', { scope: '/dashboard/receiving' }).catch(() => null);
    }
    const onOnline = () => {
      setOnline(true);
      void sync();
    };
    const onOffline = () => setOnline(false);
    const onQueue = () => void refreshCount();
    const onDrainedEvent = (e: Event) => onDrained((e as CustomEvent<DrainResult>).detail);
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(QUEUE_EVENT, onQueue);
    window.addEventListener(OUTBOX_EVENT, onQueue);
    window.addEventListener(DRAINED_EVENT, onDrainedEvent);
    window.addEventListener('beforeinstallprompt', onInstall);
    void refreshCount().then(() => sync());
    const timer = window.setInterval(() => void sync(), 60_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(QUEUE_EVENT, onQueue);
      window.removeEventListener(OUTBOX_EVENT, onQueue);
      window.removeEventListener(DRAINED_EVENT, onDrainedEvent);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.clearInterval(timer);
    };
  }, [refreshCount, sync, onDrained]);

  const chip = !online
    ? { testId: 'pwa-offline-banner', icon: <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />, text: tr('pwa.offline') }
    : syncingShown
      ? { testId: 'pwa-sync-banner', icon: <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />, text: t('pwa.syncing') }
      : needsSignIn && queued > 0
        ? {
            testId: 'pwa-signin-banner',
            icon: <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />,
            text: tr('pwa.signInToUpload'),
          }
      : queued > 0
        ? {
            testId: 'pwa-sync-banner',
            icon: <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />,
            text: syncError ? t('pwa.syncFailed') : queuedText,
          }
        : attributed.length > 0
          ? {
              testId: 'pwa-attributed',
              icon: <UploadCloud className="h-4 w-4 shrink-0" aria-hidden="true" />,
              text:
                attributed.length === 1
                  ? tr('pwa.capturedByOne', { names })
                  : tr('pwa.capturedByMany', { count: formatNumber(attributed.length, locale), names }),
            }
          : null;

  return (
    <>
      <link rel="manifest" href="/pwa/manifest.webmanifest" />
      <link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />
      <meta name="theme-color" content="#F6F8F7" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <style>{INSTALLED_CSS}</style>

      {/* Fixed, out of the flow: appearing or leaving never moves the page (CLS ≤ 0.05). */}
      <div
        className="pointer-events-none fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4"
        style={{ top: 'calc(var(--rm-header-h, 4.25rem) + 0.5rem)' }}
      >
        <div role="status" aria-live="polite" className="contents">
          {chip ? (
            <p
              data-testid={chip.testId}
              className="pointer-events-auto inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink shadow-card"
            >
              {chip.icon}
              <span>{chip.text}</span>
              {!online && queued > 0 ? (
                <span data-testid="pwa-queue-count" className="text-muted">
                  · {queuedText}
                </span>
              ) : null}
              {queued > 0 ? (
                <button
                  type="button"
                  data-testid="pwa-outbox-open"
                  onClick={() => setStatusOpen(true)}
                  className="-my-2 -me-3 inline-flex min-h-12 items-center rounded-full px-3 font-semibold text-primary underline underline-offset-4"
                >
                  {tr('pwa.details')}
                </button>
              ) : null}
            </p>
          ) : null}
        </div>
        {others > 0 && online && !chip ? (
          <p
            data-testid="pwa-others-queued"
            className="pointer-events-auto rounded-full border border-line bg-surface px-4 py-2 text-sm text-muted shadow-card"
          >
            {tr('pwa.othersQueued', { count: formatNumber(others, locale) })}
          </p>
        ) : null}
        {installEvent && !installed ? (
          <button
            type="button"
            data-testid="pwa-install"
            onClick={async () => {
              await installEvent.prompt().catch(() => null);
              setInstallEvent(null);
            }}
            className="pointer-events-auto inline-flex min-h-12 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink shadow-card"
          >
            <Download className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t('pwa.install')}
          </button>
        ) : null}
      </div>
      <OutboxStatusSheet
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        items={items}
        userId={userId}
        onRetry={() => void sync()}
      />
    </>
  );
}
