'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button, Card, LinkButton } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';

/**
 * In-shell error boundary for the approvals queue (approvals-19): the sidebar
 * and bottom bar stay, the cause is plain, and there is a retry and a way out.
 * It also wraps the nested pay run, so it names whichever page actually failed
 * instead of blaming the queue for a pay-run error.
 */
export default function ApprovalsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT(approvals);
  const payRun = (usePathname() ?? '').startsWith('/dashboard/approvals/pay-run');
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card padding="lg" role="alert" className="mx-auto mt-6 flex max-w-md flex-col items-center gap-3 text-center" data-testid="approvals-error">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/12 text-danger">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="text-lg font-bold text-ink">{t(payRun ? 'errorPage.titlePayRun' : 'errorPage.title')}</h1>
      <p className="text-sm text-muted">{t(payRun ? 'errorPage.bodyPayRun' : 'errorPage.body')}</p>
      {error.digest ? <bdi className="text-xs tabular-nums text-subtle">{error.digest}</bdi> : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => reset()} className="h-12">
          {t('errorPage.retry')}
        </Button>
        <LinkButton href="/dashboard" variant="secondary" className="h-12">
          {t('errorPage.home')}
        </LinkButton>
      </div>
    </Card>
  );
}
