'use client';

import { startTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button, Card } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { orders as ordersNs } from '@/lib/i18n/messages/orders';

/**
 * In-shell error for every orders route (list, wizard, detail): says what failed,
 * that nothing was lost, and retries in place. A missing order is notFound(), not this.
 */
export default function OrdersError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT(ordersNs);
  const router = useRouter();
  const pathname = usePathname();
  const detail = /^\/dashboard\/orders\/[^/]+$/.test(pathname) && !pathname.endsWith('/new') && !pathname.endsWith('/capture');
  return (
    <Card elevated padding="lg" className="mx-auto max-w-xl text-center" role="alert">
      <TriangleAlert className="mx-auto h-8 w-8 text-warn" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-bold text-ink">
        {detail ? t('detail.loadErrorTitle') : t('list.loadErrorTitle')}
      </h1>
      <p className="mt-1 text-sm text-muted">{detail ? t('detail.loadErrorBody') : t('list.loadErrorBody')}</p>
      <Button
        className="mt-4 min-h-12"
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        <RotateCw className="h-4 w-4" aria-hidden="true" /> {t('list.retry')}
      </Button>
      {error.digest ? <p className="mt-3 font-mono text-xs text-subtle">{error.digest}</p> : null}
    </Card>
  );
}
