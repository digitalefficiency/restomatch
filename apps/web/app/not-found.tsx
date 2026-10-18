import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Button, Card } from '@/lib/components';
import { common } from '@/lib/i18n/messages/common';
import { getT } from '@/lib/i18n/server';

/**
 * 404 page (Ledger style). Rendered by the root layout, so it inherits the
 * warm-paper canvas + RTL.
 */
export default async function NotFound() {
  const t = await getT(common);
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <Card elevated flow padding="lg" className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="font-mono text-sm font-semibold tabular-nums text-primary">404</p>
          <h1 className="mt-1 text-xl font-bold text-ink">{t('notFound.title')}</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">{t('notFound.body')}</p>
        </div>
        <Link href="/dashboard">
          <Button variant="primary">{t('actions.backToOverview')}</Button>
        </Link>
      </Card>
    </main>
  );
}
