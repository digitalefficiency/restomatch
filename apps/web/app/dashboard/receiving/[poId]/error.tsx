'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useDir, useT } from '@/lib/i18n/client';
import { receivingDelivery } from '@/lib/i18n/messages/receiving/delivery';

/**
 * The Delivery Check failed to render (RCV-28): stay in the shell, say so, and
 * offer "try again" and the deliveries list. Counts already saved are on the
 * server or on the phone (lib/pwa/lineOutbox) — a retry resumes them.
 */
export default function ReceivingPoError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const td = useT(receivingDelivery);
  const dir = useDir();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" dir={dir} className="mx-auto max-w-md space-y-4 py-10 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-danger" aria-hidden="true" />
      <h1 className="text-2xl font-bold text-ink">{td('delivery.error.title')}</h1>
      <p className="text-base text-muted">{td('delivery.error.body')}</p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-lg font-bold text-on-primary"
        >
          <RefreshCw className="h-5 w-5" aria-hidden="true" />
          {td('delivery.error.retry')}
        </button>
        <Link href="/dashboard/receiving" className="inline-flex min-h-12 items-center justify-center text-base font-semibold text-primary underline underline-offset-4">
          {td('delivery.error.back')}
        </Link>
      </div>
      {error.digest ? <p className="text-sm text-muted" dir="ltr">{error.digest}</p> : null}
    </div>
  );
}
