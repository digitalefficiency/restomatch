'use client';

import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from './cn';

/** Accessible loading spinner. */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  const t = useT(components);
  return (
    <span
      role="status"
      aria-label={label ?? t('spinner.loading')}
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
