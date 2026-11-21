'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/lib/components';
import { Sheet } from '@/lib/components/overlay/Sheet';
import { useNavBadges } from '@/lib/components/notifications';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { applyAppBadge, openT2Count } from './badge';
import {
  TASK_COMPLETED_EVENT,
  isIosSafari,
  loadState,
  persistStorage,
  saveState,
  shouldOffer,
  withAsked,
  withCompletedTask,
  withInstalled,
  type Platform,
} from './install';
import { registerAppWorker } from './registerWorker';
import { DRAINED_EVENT } from './useOutboxDrainer';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const kv = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * W3-03b · the app-wide PWA shell (dark until the layout passes `appPwa`):
 * manifest link, one service worker at /dashboard/, the install sheet after the
 * 2nd completed task (no re-ask for 14 days; iOS gets a 3-step coach),
 * `storage.persist()` after install, and the app-icon badge = open T2 items.
 * Push permission is never asked here — only from a tap in
 * /dashboard/settings/notifications. Renders nothing until the sheet opens.
 */
export function AppPwa() {
  const t = useT(common);
  const badges = useNavBadges();
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [sheet, setSheet] = useState<Platform | null>(null);

  const standalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const platform = (): Platform =>
    deferred.current ? 'prompt' : isIosSafari(navigator.userAgent, navigator.maxTouchPoints) ? 'ios' : 'none';

  const onTaskDone = useCallback(() => {
    const store = kv();
    const next = withCompletedTask(loadState(store));
    const now = Date.now();
    const p = platform();
    if (shouldOffer(next, now, p, standalone())) {
      saveState(store, withAsked(next, now));
      setSheet(p);
    } else saveState(store, next);
  }, []);

  useEffect(() => {
    void registerAppWorker();
    if (standalone()) {
      const s = loadState(kv());
      if (!s.installed) saveState(kv(), withInstalled(s));
      void persistStorage(navigator.storage);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;
    };
    const onInstalled = () => {
      saveState(kv(), withInstalled(loadState(kv())));
      setSheet(null);
      void persistStorage(navigator.storage);
    };
    const onDrained = (e: Event) => {
      if (((e as CustomEvent<{ sent?: unknown[] }>).detail?.sent?.length ?? 0) > 0) onTaskDone();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(TASK_COMPLETED_EVENT, onTaskDone);
    window.addEventListener(DRAINED_EVENT, onDrained);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(TASK_COMPLETED_EVENT, onTaskDone);
      window.removeEventListener(DRAINED_EVENT, onDrained);
    };
  }, [onTaskDone]);

  const t2 = openT2Count(badges);
  useEffect(() => {
    void applyAppBadge(navigator as unknown as Parameters<typeof applyAppBadge>[0], t2);
  }, [t2]);

  return (
    <>
      <link rel="manifest" href="/pwa/manifest.webmanifest" />
      <Sheet
        open={sheet === 'prompt'}
        onClose={() => setSheet(null)}
        title={t('pwa.install.title')}
        primary={
          <Button
            type="button"
            size="xl"
            icon={<Download className="h-5 w-5" aria-hidden="true" />}
            onClick={async () => {
              const ev = deferred.current;
              setSheet(null);
              if (!ev) return;
              await ev.prompt().catch(() => null);
              const choice = await ev.userChoice.catch(() => null);
              deferred.current = null;
              if (choice?.outcome === 'accepted') {
                saveState(kv(), withInstalled(loadState(kv())));
                void persistStorage(navigator.storage);
              }
            }}
          >
            {t('pwa.install.install')}
          </Button>
        }
      >
        <p className="mb-3 text-body text-ink">{t('pwa.install.body')}</p>
        <Button type="button" variant="ghost" size="xl" fullWidth onClick={() => setSheet(null)}>
          {t('pwa.install.later')}
        </Button>
      </Sheet>
      <Sheet
        open={sheet === 'ios'}
        onClose={() => setSheet(null)}
        title={t('pwa.install.iosTitle')}
        primary={
          <Button type="button" size="xl" onClick={() => setSheet(null)}>
            {t('pwa.install.done')}
          </Button>
        }
      >
        <ol className="flex list-decimal flex-col gap-2 ps-6 text-body text-ink">
          <li>{t('pwa.install.iosStep1')}</li>
          <li>{t('pwa.install.iosStep2')}</li>
          <li>{t('pwa.install.iosStep3')}</li>
        </ol>
      </Sheet>
    </>
  );
}
