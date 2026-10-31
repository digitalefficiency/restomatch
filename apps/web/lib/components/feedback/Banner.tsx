'use client';

import { useState } from 'react';
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { cn } from '../cn';

export type BannerTone = 'info' | 'warn' | 'danger' | 'success' | 'neutral';

const TONE: Record<BannerTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'bg-info-subtle border-info-subtle', icon: 'text-info', Icon: Info },
  warn: { box: 'bg-warn-subtle border-warn-subtle', icon: 'text-warn', Icon: TriangleAlert },
  danger: { box: 'bg-danger-subtle border-danger-subtle', icon: 'text-danger', Icon: OctagonAlert },
  success: { box: 'bg-primary-subtle border-primary-subtle', icon: 'text-primary', Icon: CircleCheck },
  neutral: { box: 'bg-neutral-subtle border-neutral-subtle', icon: 'text-neutral', Icon: Info },
};

/**
 * Page-level message: one per page, under the page header, not sticky, ≤2
 * sentences and ≤1 action. No `role="alert"` on load (F7) — pass
 * `live` only when the banner appears in response to something the user did.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  dismissible = false,
  live = false,
  className,
}: {
  tone?: BannerTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  dismissible?: boolean;
  live?: boolean;
  className?: string;
}) {
  const t = useT(components);
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const { box, icon, Icon } = TONE[tone];
  return (
    <div
      role={live ? 'status' : undefined}
      data-banner={tone}
      className={cn('flex items-start gap-3 rounded-card border px-4 py-3 text-body-sm text-ink', box, className)}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink">{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
      {dismissible ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('ds.banner.dismiss')}
          className="-m-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-micro hover:bg-surface hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** A message on a row or a field (C9): small, icon + text, no live region by default. */
export function InlineMessage({
  tone = 'info',
  children,
  id,
  className,
}: {
  tone?: Exclude<BannerTone, 'neutral'>;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  const { icon, Icon } = TONE[tone];
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-body-sm', tone === 'danger' ? 'text-danger' : 'text-ink', className)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', icon)} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
