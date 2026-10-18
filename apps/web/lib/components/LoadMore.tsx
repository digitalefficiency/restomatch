'use client';

import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { Button } from './Button';

/**
 * "Load more" control for cursor-paginated lists. Hidden once `hasMore` is
 * false. Keeps the busy + disabled state accessible.
 */
export function LoadMore({
  onClick,
  loading = false,
  hasMore,
  label,
  className,
}: {
  onClick: () => void;
  loading?: boolean;
  hasMore: boolean;
  label?: string;
  className?: string;
}) {
  const t = useT(components);
  if (!hasMore) return null;
  return (
    <div className={`flex justify-center pt-2 ${className ?? ''}`}>
      <Button variant="secondary" size="sm" onClick={onClick} loading={loading} disabled={loading}>
        {label ?? t('loadMore.label')}
      </Button>
    </div>
  );
}
