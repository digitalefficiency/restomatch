'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, LinkButton } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { common } from '@/lib/i18n/messages/common';
import { useOnline } from '@/lib/net/online';

/**
 * In-shell error boundary (W1-04, perf-states-09; lens-perf-states §2.6). A
 * page under /dashboard that throws renders here, INSIDE the layout: header,
 * nav and branch switcher stay, so the receiver keeps their place. "נסו שוב"
 * re-fetches the server tree AND resets the boundary in one transition (a
 * bare `reset()` would re-render the same failed RSC payload). The digest is
 * shown so a report can be matched to the server log. No contact address
 * until the single contact config (W1-12) exists — never an invented one.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(common);
  const router = useRouter();
  const online = useOnline();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  // Offline when it failed: try again by itself once the network is back.
  useEffect(() => {
    if (online) return;
    const onOnline = () => retry();
    window.addEventListener('online', onOnline, { once: true });
    return () => window.removeEventListener('online', onOnline);
    // retry is recreated per render; the listener only needs the latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const digest = error.digest;

  return (
    <section aria-labelledby="dashboard-error-title" data-testid="dashboard-error" className="mx-auto max-w-xl">
      <Card padding="lg" className="space-y-4">
        <div>
          <h1 id="dashboard-error-title" className="text-2xl font-bold text-ink">
            {t('shell.error.title')}
          </h1>
          <p className="mt-1.5 text-base text-muted" role="alert">
            {!online ? t('shell.error.offline') : digest ? t('shell.error.body') : t('shell.error.bodyNoCode')}
          </p>
          {digest ? (
            <p className="mt-2 text-sm text-muted">
              <bdi className="font-mono tabular-nums">{t('shell.error.code', { digest })}</bdi>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={retry} loading={pending} className="min-h-[44px]" data-testid="dashboard-error-retry">
            {pending ? t('shell.error.retrying') : t('shell.error.retry')}
          </Button>
          <LinkButton href="/dashboard" variant="secondary" className="min-h-[44px]">
            {t('shell.error.home')}
          </LinkButton>
        </div>
      </Card>
    </section>
  );
}
