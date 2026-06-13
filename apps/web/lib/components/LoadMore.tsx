'use client';

import { Button } from './Button';

/**
 * "טען עוד" (load more) control for cursor-paginated lists. Hidden once
 * `hasMore` is false. Keeps the busy + disabled state accessible.
 */
export function LoadMore({
  onClick,
  loading = false,
  hasMore,
  label = 'טען עוד',
  className,
}: {
  onClick: () => void;
  loading?: boolean;
  hasMore: boolean;
  label?: string;
  className?: string;
}) {
  if (!hasMore) return null;
  return (
    <div className={`flex justify-center pt-2 ${className ?? ''}`}>
      <Button variant="secondary" size="sm" onClick={onClick} loading={loading} disabled={loading}>
        {label}
      </Button>
    </div>
  );
}
