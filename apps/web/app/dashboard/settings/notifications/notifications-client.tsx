'use client';

import { useEffect, useState } from 'react';
import { BellRing, BellOff } from 'lucide-react';
import { Button, Card, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { trpc } from '@/lib/trpc/client';
import { isIosSafari } from '@/lib/pwa/install';
import { currentSubscription, pushSupport, subscribeThisDevice, unsubscribeThisDevice, type PushEnv } from '@/lib/pwa/pushClient';

type Reason = 'noKey' | 'denied' | 'unsupported' | 'needsInstall' | 'failed';
const CHANNELS = ['push', 'email', 'whatsapp'] as const;
const CHANNEL_LABEL = { push: 'pwa.notify.channelPush', email: 'pwa.notify.channelEmail', whatsapp: 'pwa.notify.channelWhatsapp' } as const;

/** Copy keys cannot hold a dot (dot-path lookup): 'delivery.late' → 'delivery_late'. */
type EventKey = 'receiver_morning_brief' | 'delivery_late' | 'approval_waiting' | 'order_reminder' | 'claim_overdue' | 'invoice_ocr_failed';
const eventKey = (kind: string) => kind.replace(/\./g, '_') as EventKey;

function browserEnv(): PushEnv {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    Notification: typeof Notification === 'undefined' ? undefined : Notification,
    serviceWorker: 'serviceWorker' in navigator ? (navigator.serviceWorker as unknown as PushEnv['serviceWorker']) : undefined,
    iosNotInstalled: isIosSafari(navigator.userAgent, navigator.maxTouchPoints) && !standalone,
  };
}

export function NotificationsClient() {
  const t = useT(common);
  const toast = useToast();
  const utils = trpc.useUtils();
  const status = trpc.push.status.useQuery();
  const subscribe = trpc.push.subscribe.useMutation();
  const unsubscribe = trpc.push.unsubscribe.useMutation();
  const setPref = trpc.push.setPref.useMutation({ onSuccess: () => utils.push.status.invalidate() });
  const test = trpc.push.test.useMutation();
  const [onDevice, setOnDevice] = useState<boolean | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const env = browserEnv();
    const s = pushSupport(env);
    if (s === 'denied') setReason('denied');
    else if (s === 'unsupported') setReason('unsupported');
    else if (s === 'needs-install') setReason('needsInstall');
    void currentSubscription(env).then((sub) => setOnDevice(sub != null));
  }, []);

  if (status.isLoading || !status.data) return null;
  const data = status.data;
  const key = data.vapidPublicKey;
  const shownReason: Reason | null = reason ?? (key ? null : 'noKey');

  async function turnOn() {
    setBusy(true);
    try {
      const out = await subscribeThisDevice(browserEnv(), key, navigator.userAgent);
      if (!out.ok) {
        setReason(out.reason === 'no-key' ? 'noKey' : out.reason === 'needs-install' ? 'needsInstall' : out.reason);
        return;
      }
      await subscribe.mutateAsync(out.input);
      setOnDevice(true);
      setReason(null);
      toast.success(t('pwa.notify.enabled'));
      void utils.push.status.invalidate();
    } catch {
      setReason('failed');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const endpoint = await unsubscribeThisDevice(browserEnv());
      if (endpoint) await unsubscribe.mutateAsync({ endpoint }).catch(() => null);
      setOnDevice(false);
      toast.success(t('pwa.notify.disabled'));
      void utils.push.status.invalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!data.available ? (
        <p role="status" className="rounded-card border border-line bg-surface-2 p-4 text-body text-ink" data-testid="push-unavailable">
          {t('pwa.notify.unavailable')}
        </p>
      ) : null}

      <Card elevated>
        <h2 className="mb-1 text-heading-sm">{t('pwa.notify.deviceTitle')}</h2>
        <p className="mb-3 text-body text-muted" role="status" aria-live="polite">
          {onDevice ? t('pwa.notify.deviceOn') : t('pwa.notify.deviceOff')}
        </p>
        {onDevice ? (
          <Button type="button" variant="secondary" size="xl" loading={busy} icon={<BellOff className="h-5 w-5" aria-hidden="true" />} onClick={turnOff}>
            {t('pwa.notify.disable')}
          </Button>
        ) : (
          <Button
            type="button"
            size="xl"
            loading={busy}
            disabled={!data.available || shownReason === 'noKey' || shownReason === 'unsupported'}
            disabledReason={shownReason ? t(`pwa.notify.${shownReason}`) : !data.available ? t('pwa.notify.unavailable') : undefined}
            icon={<BellRing className="h-5 w-5" aria-hidden="true" />}
            onClick={turnOn}
          >
            {t('pwa.notify.enable')}
          </Button>
        )}
        {shownReason && shownReason !== 'noKey' && shownReason !== 'unsupported' ? (
          <p className="mt-3 text-body text-ink">{t(`pwa.notify.${shownReason}`)}</p>
        ) : null}
        <p className="mt-3 text-body-sm text-muted">{t('pwa.notify.quiet')}</p>
      </Card>

      <Card elevated>
        <h2 className="mb-3 text-heading-sm">{t('pwa.notify.eventsTitle')}</h2>
        <ul className="flex flex-col divide-y divide-line">
          {data.events.map((ev) => (
            <li key={ev.kind} className="flex flex-col gap-2 py-3">
              <span className="text-body font-medium text-ink">{t(`pwa.notify.events.${eventKey(ev.kind)}`)}</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t(`pwa.notify.events.${eventKey(ev.kind)}`)}>
                {CHANNELS.map((ch) => (
                  <label
                    key={ch}
                    className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-body text-ink has-[:checked]:border-primary has-[:checked]:bg-primary-subtle"
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      className="h-5 w-5 accent-primary"
                      checked={ev[ch]}
                      disabled={!data.available || setPref.isPending}
                      onChange={(e) => setPref.mutate({ eventKind: ev.kind, channel: ch, enabled: e.target.checked })}
                    />
                    {t(CHANNEL_LABEL[ch])}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Button
        type="button"
        variant="secondary"
        size="lg"
        loading={test.isPending}
        onClick={async () => {
          const r = await test.mutateAsync().catch(() => null);
          if (r?.status === 'skipped_no_provider') toast.info(t('pwa.notify.testSkipped'));
        }}
      >
        {t('pwa.notify.test')}
      </Button>
    </>
  );
}
