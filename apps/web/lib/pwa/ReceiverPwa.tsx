'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff, Download, Loader2, UploadCloud } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatNumber } from '@/lib/i18n/format';
import { ingest } from '@/lib/i18n/messages/ingest';
import { trpc } from '@/lib/trpc/client';
import {
  QUEUE_EVENT,
  idbAvailable,
  idbQueueStore,
  processQueue,
  type QueuedPhoto,
} from './offlineQueue';

/** Encode a Blob to base64 (chunked — large photos overflow String.fromCharCode). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

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
 * /dashboard/receiving), the he/en offline banner, the offline photo queue
 * uploader and the install prompt. Renders nothing visible while online with
 * an empty queue.
 */
export function ReceiverPwa({ restaurantId }: { restaurantId: string }) {
  const t = useT(ingest);
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const running = useRef(false);

  const refreshCount = useCallback(async () => {
    if (!idbAvailable()) return;
    try {
      setQueued((await idbQueueStore.list()).filter((i) => i.restaurantId === restaurantId).length);
    } catch {
      /* private mode without IndexedDB */
    }
  }, [restaurantId]);

  const upload = useCallback(
    async (item: QueuedPhoto) => {
      // Same clientUploadId → same scan object → registerInvoice dedupes (M8).
      const scan = await utils.client.scans.upload.mutate({
        contentBase64: await blobToBase64(item.blob),
        mimeType: item.mimeType,
        supplierName: item.supplierName,
        clientUploadId: item.clientUploadId,
      });
      const imageUrl = scan.signedUrl;
      if (!imageUrl) throw new Error('upload returned no URL');
      const receipt = await utils.client.receiving.startReceipt.mutate({ poId: item.poId });
      return utils.client.receiving.registerInvoice.mutate({
        grId: receipt.receiptId,
        imageUrl,
        supplierId: item.supplierId,
      });
    },
    [utils],
  );

  const sync = useCallback(async () => {
    if (running.current || !idbAvailable() || !navigator.onLine) return;
    running.current = true;
    setSyncing(true);
    try {
      const r = await processQueue(idbQueueStore, upload, () => navigator.onLine, restaurantId);
      setSyncError(r.failed.length > 0);
      setQueued(r.remaining);
    } catch {
      setSyncError(true);
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [upload, restaurantId]);

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
    const onInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(QUEUE_EVENT, onQueue);
    window.addEventListener('beforeinstallprompt', onInstall);
    void refreshCount().then(() => sync());
    const timer = window.setInterval(() => void sync(), 60_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(QUEUE_EVENT, onQueue);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.clearInterval(timer);
    };
  }, [refreshCount, sync]);

  return (
    <>
      <link rel="manifest" href="/pwa/manifest.webmanifest" />
      <link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />
      <meta name="theme-color" content="#07120D" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <style>{INSTALLED_CSS}</style>

      {!online ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-offline-banner"
          className="mb-4 flex items-start gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-ink"
        >
          <CloudOff className="mt-0.5 h-6 w-6 shrink-0 text-warn" aria-hidden="true" />
          <div>
            <p className="font-bold">{t('pwa.offlineTitle')}</p>
            <p className="text-sm text-muted">{t('pwa.offlineBody')}</p>
            {queued > 0 ? (
              <p className="mt-1 text-sm font-semibold" data-testid="pwa-queue-count">
                {t('pwa.queued', { count: formatNumber(queued, locale) })}
              </p>
            ) : null}
          </div>
        </div>
      ) : queued > 0 || syncing ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-sync-banner"
          className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm text-ink"
        >
          {syncing ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          ) : (
            <UploadCloud className="h-5 w-5 text-primary" aria-hidden="true" />
          )}
          <span>
            {syncing ? t('pwa.syncing') : syncError ? t('pwa.syncFailed') : t('pwa.queued', { count: formatNumber(queued, locale) })}
          </span>
        </div>
      ) : null}

      {installEvent && !installed ? (
        <button
          type="button"
          data-testid="pwa-install"
          onClick={async () => {
            await installEvent.prompt().catch(() => null);
            setInstallEvent(null);
          }}
          className="mb-4 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-start text-sm text-ink transition-colors hover:border-primary/40"
        >
          <Download className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="block font-semibold">{t('pwa.install')}</span>
            <span className="block text-xs text-muted">{t('pwa.installHint')}</span>
          </span>
        </button>
      ) : null}
    </>
  );
}
