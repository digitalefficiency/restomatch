'use client';

import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from './cn';

/**
 * Loading spinner. Standalone it is a `role="status"` with a label. Inside a
 * control that already says it is busy (a loading Button sets `aria-busy`),
 * pass `decorative` so it isn't announced twice (a11y-18). It keeps turning
 * under reduced motion (`.motion-essential`): it is the one essential animation.
 */
export function Spinner({
  className,
  label,
  decorative = false,
}: {
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const t = useT(components);
  return (
    <span
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : (label ?? t('spinner.loading'))}
      aria-hidden={decorative || undefined}
      className={cn(
        'motion-essential inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
