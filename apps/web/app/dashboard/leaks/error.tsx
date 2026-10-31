'use client';

import Link from 'next/link';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { leaks } from '@/lib/i18n/messages/leaks';
import { Button } from '@/lib/components';

/**
 * In-shell failure of a leak screen: "not available · try again" — never a ₪0,
 * never a blank page. The shell (nav, header) stays; `reset` re-renders the route.
 */
export default function LeaksError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT(leaks);
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-2xl border border-line bg-surface p-6 text-center shadow-card" data-testid="leaks-error">
      <AlertCircle className="mx-auto h-8 w-8 text-warn" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-bold text-ink">{t('hub.error.title')}</h1>
      <p className="mt-1 text-sm text-muted">{t('hub.error.body')}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{t('states.unavailable')}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset} className="min-h-11">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {t('hub.error.retry')}
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-muted hover:text-ink"
        >
          {t('hub.error.back')}
        </Link>
      </div>
    </div>
  );
}
