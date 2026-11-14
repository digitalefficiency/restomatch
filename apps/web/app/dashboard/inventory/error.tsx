'use client';

import { CircleAlert } from 'lucide-react';
import { Button, EmptyState } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { inventory as inventoryNs } from '@/lib/i18n/messages/inventory';

/** In-shell error for the inventory screens: calm, with one retry ("נסו שוב"). */
export default function InventoryError({ reset }: { error: Error; reset: () => void }) {
  const t = useT(inventoryNs);
  return (
    <div role="status">
      <EmptyState
        icon={<CircleAlert className="h-6 w-6" />}
        title={t('count.loadError')}
        action={
          <Button variant="secondary" className="touch-target" onClick={reset}>
            {t('count.retry')}
          </Button>
        }
      />
    </div>
  );
}
