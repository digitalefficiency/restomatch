import Link from 'next/link';
import { Compass } from 'lucide-react';
import { auth } from '@/auth';
import { Card } from '@/lib/components';
import { common } from '@/lib/i18n/messages/common';
import { getT } from '@/lib/i18n/server';
import { MarketingShell } from './(marketing)/_components/MarketingShell';
import { NotFoundContent } from './(marketing)/_components/NotFoundContent';

/**
 * Root 404, rendered by the root layout (warm-paper canvas + RTL).
 *
 * Anonymous-aware (W1-12 · mkt-12, perf-states-09): a visitor gets the
 * marketing chrome and public destinations; only a signed-in member is offered
 * the way back to the app. The action is a styled Link, never Link > Button
 * (nested interactive).
 */
export default async function NotFound() {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return (
      <MarketingShell>
        <NotFoundContent />
      </MarketingShell>
    );
  }

  const t = await getT(common);
  return (
    <main
      className="flex min-h-screen items-center justify-center px-6 py-16"
      data-testid="not-found"
    >
      <Card
        elevated
        flow
        padding="lg"
        className="flex max-w-md flex-col items-center gap-4 text-center"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold tabular-nums text-primary">404</p>
          <h1 className="mt-1 text-xl font-bold text-ink">{t('notFound.title')}</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">{t('notFound.body')}</p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-on-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {t('actions.backToOverview')}
        </Link>
      </Card>
    </main>
  );
}
