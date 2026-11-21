'use client';

import { Button, EmptyState } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';

/** In-shell error state with retry (DoD-5). */
export default function ContractsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT(contractsNs);
  return (
    <div role="alert">
    <EmptyState
      kind="error"
      title={t('queue.errorTitle')}
      action={
        <Button variant="secondary" onClick={() => reset()}>
          {t('queue.retry')}
        </Button>
      }
    />
    </div>
  );
}
