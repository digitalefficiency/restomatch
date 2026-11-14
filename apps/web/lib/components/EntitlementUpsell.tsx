'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { Button } from './Button';
import { Card } from './Card';
import { featureLabel, type EntitlementCause } from './entitlement';

export { entitlementCauseOf, featureLabel } from './entitlement';
export type { EntitlementCause } from './entitlement';

/**
 * Upsell card shown when a feature is gated behind a paid plan. Pass either the
 * raw `feature` key or the full `cause`. Renders a localized CTA linking to
 * `/pricing`. The `compact` variant is for inline teasers (e.g. the overview).
 */
export function EntitlementUpsell({
  feature,
  cause,
  title,
  compact = false,
  className,
}: {
  feature?: string;
  cause?: EntitlementCause | null;
  title?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const t = useT(components);
  const locale = useLocale();
  const key = cause?.feature ?? feature ?? '';
  const label = featureLabel(key, locale);

  if (compact) {
    return (
      <Card
        elevated
        padding="md"
        className={`flex flex-col gap-3 border-primary/20 bg-primary/5 sm:flex-row sm:items-center sm:justify-between ${className ?? ''}`}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {title ?? t('entitlement.compactTitle', { feature: label })}
            </p>
            <p className="mt-0.5 text-xs text-muted">{t('entitlement.compactBody')}</p>
          </div>
        </div>
        <Link href="/pricing" className="shrink-0">
          <Button variant="primary" size="sm">
            {t('entitlement.compactCta')}
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card
      elevated
      padding="lg"
      className={`flex flex-col items-center gap-4 border-primary/20 bg-primary/5 text-center ${className ?? ''}`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
        <Lock className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-lg font-bold text-ink">
          {title ?? t('entitlement.title', { feature: label })}
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          {t('entitlement.body', { feature: label })}
        </p>
      </div>
      <Link href="/pricing">
        <Button variant="primary">{t('entitlement.cta')}</Button>
      </Link>
    </Card>
  );
}

/**
 * Generic (non-entitlement) error surface. Used as the fallback branch when an error is NOT
 * ENTITLEMENT_REQUIRED. DS3 (kit "שגיאה"): it says what failed, what is safe, offers one action
 * and never shows ₪0 — calm, with no red and no icon, since a view that did not load is not money
 * waiting for a person. Still announced (`role="alert"`) as before.
 */
export function ErrorNotice({
  title,
  message,
  safe,
  action,
  className,
}: {
  title?: React.ReactNode;
  message?: React.ReactNode;
  /** What is safe despite the failure: "ההחלטות שכבר התקבלו שמורות." */
  safe?: React.ReactNode;
  /** The one action, e.g. a small secondary "נסו שוב". */
  action?: React.ReactNode;
  className?: string;
}) {
  const t = useT(components);
  return (
    <Card padding="md" role="alert" data-error-notice="" className={`flex flex-col items-start gap-1 ${className ?? ''}`}>
      <p className="text-body-sm font-semibold text-fg">{title ?? t('errorNotice.title')}</p>
      {message ? <p className="text-body-sm text-fg-secondary">{message}</p> : null}
      {safe ? <p className="text-body-sm text-fg-secondary">{safe}</p> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </Card>
  );
}
