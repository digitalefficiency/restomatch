'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Share2 } from 'lucide-react';
import { Button, Card, LinkButton, SectionHeader, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { claimSharesFor, dropShare, readShare, routeShare, shareText, type SharedItem, type ShareRoute } from '@/lib/pwa/shareInbox';

type View = { state: 'loading' } | { state: 'ready'; item: SharedItem | null; route: ShareRoute };

export function ShareClient({
  id,
  fallback,
  filesLost,
  orderCapture,
  canReceive,
  userId,
}: {
  id: string | null;
  fallback: { title: string; text: string; url: string };
  filesLost: boolean;
  orderCapture: boolean;
  canReceive: boolean;
  /** Another user's parked shares are wiped before anything is read (shared phone). */
  userId: string | null;
}) {
  const t = useT(common);
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<View>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    void (async () => {
      // No session id → nothing parked is shown (never another user's share).
      const owned = userId ? (await claimSharesFor(userId), true) : false;
      const parked = id && owned ? await readShare(id) : null;
      const item: SharedItem | null =
        parked ?? (shareText(fallback) ? { id: '', at: 0, owner: userId ?? '', ...fallback, skipped: 0, files: [] } : null);
      const route = routeShare(item);
      // A text-only share is read once: the order capture takes it from the URL.
      if (parked && route.kind === 'orderText') await dropShare(parked);
      if (!live) return;
      if (route.kind === 'orderText' && orderCapture) {
        router.replace(`/dashboard/orders/capture?text=${encodeURIComponent(route.text)}`);
      }
      setView({ state: 'ready', item, route });
    })();
    return () => {
      live = false;
    };
    // The share is read once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (view.state === 'loading' || (view.route.kind === 'orderText' && orderCapture)) {
    return (
      <div className="mx-auto max-w-3xl">
        <SectionHeader level={1} title={t('pwa.share.title')} />
        <p role="status" aria-live="polite" className="text-body text-muted">
          {view.state === 'loading' ? t('pwa.share.loading') : t('pwa.share.toOrder')}
        </p>
      </div>
    );
  }

  const { item, route } = view;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="share-page" data-route={route.kind}>
      <SectionHeader level={1} title={t('pwa.share.title')} />
      {filesLost ? (
        <p role="status" className="text-body text-ink">
          {t('pwa.share.filesLost')}
        </p>
      ) : null}
      {item && item.skipped > 0 ? (
        <p role="status" className="text-body text-ink">
          {t('pwa.share.skipped', { count: item.skipped })}
        </p>
      ) : null}

      {route.kind === 'files' && item ? (
        <Card elevated>
          <h2 className="mb-2 text-heading-sm text-ink">{t('pwa.share.filesTitle', { count: route.count })}</h2>
          <ul className="mb-3 flex flex-col gap-1">
            {item.files.map((f) => (
              <li key={f.key} className="flex items-center gap-2 text-body text-ink">
                <FileText className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                <bdi className="truncate">{f.name || f.type}</bdi>
              </li>
            ))}
          </ul>
          <p className="mb-4 text-body text-muted">{canReceive ? t('pwa.share.filesBody') : t('pwa.share.filesOther')}</p>
          <div className="flex flex-col gap-3">
            {canReceive ? (
              <LinkButton href="/dashboard/receiving" size="xl" fullWidth>
                {t('pwa.share.toReceiving')}
              </LinkButton>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="xl"
              onClick={async () => {
                await dropShare(item);
                toast.success(t('pwa.share.discarded'));
                setView({ state: 'ready', item: null, route: { kind: 'empty' } });
              }}
            >
              {t('pwa.share.discard')}
            </Button>
          </div>
        </Card>
      ) : null}

      {route.kind === 'orderText' ? (
        <Card elevated>
          <h2 className="mb-2 text-heading-sm text-ink">{t('pwa.share.textTitle')}</h2>
          <p className="mb-3 text-body text-muted">{t('pwa.share.textBody')}</p>
          <pre dir="auto" className="mb-4 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-body text-ink">
            {route.text}
          </pre>
          <Button
            type="button"
            size="xl"
            fullWidth
            icon={<Share2 className="h-5 w-5" aria-hidden="true" />}
            onClick={async () => {
              try {
                if (typeof navigator.share === 'function') {
                  await navigator.share({ text: route.text });
                  return;
                }
              } catch {
                // Dismissed: fall through to copy.
              }
              try {
                await navigator.clipboard.writeText(route.text);
                toast.success(t('pwa.share.copied'));
              } catch {
                // Clipboard blocked: the text stays selectable above.
              }
            }}
          >
            {t('pwa.share.copy')}
          </Button>
        </Card>
      ) : null}

      {route.kind === 'empty' ? (
        <Card elevated>
          <h2 className="mb-2 text-heading-sm text-ink">{t('pwa.share.emptyTitle')}</h2>
          <p className="mb-4 text-body text-muted">{t('pwa.share.emptyBody')}</p>
          <LinkButton href="/dashboard" variant="secondary" size="xl" fullWidth>
            {t('pwa.share.home')}
          </LinkButton>
        </Card>
      ) : null}
    </div>
  );
}
