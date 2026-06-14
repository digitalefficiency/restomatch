import Link from 'next/link';
import { Lock, ShieldAlert } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';

/**
 * The cause attached to an ENTITLEMENT_REQUIRED TRPCError (see
 * `requireFeature` in @restomatch/api): `{ code, feature, planKey }`.
 * superjson preserves the cause object across the wire.
 */
export interface EntitlementCause {
  code: 'ENTITLEMENT_REQUIRED';
  feature: string;
  planKey?: string | null;
}

const FEATURE_LABELS: Record<string, string> = {
  advanced_analytics: 'אנליטיקה מתקדמת',
  accounting_export: 'ייצוא להנהלת חשבונות',
  whatsapp_alerts: 'התראות וואטסאפ',
  integrations: 'אינטגרציות',
};

/**
 * Detects whether a thrown/serialized error carries the ENTITLEMENT_REQUIRED
 * cause. Works for both server-side `TRPCError` (with `.cause`) and the
 * client-side `TRPCClientError` (which exposes the cause under `data` /
 * `shape.data` after superjson round-trips). Returns the typed cause or null.
 */
export function entitlementCauseOf(err: unknown): EntitlementCause | null {
  if (!err || typeof err !== 'object') return null;
  // Direct TRPCError.cause (server caller path).
  const direct = (err as { cause?: unknown }).cause;
  if (isEntitlementCause(direct)) return direct;
  // Some serialized shapes nest it under data.cause.
  const data = (err as { data?: { cause?: unknown } }).data;
  if (data && isEntitlementCause(data.cause)) return data.cause;
  return null;
}

function isEntitlementCause(c: unknown): c is EntitlementCause {
  return (
    !!c &&
    typeof c === 'object' &&
    (c as { code?: unknown }).code === 'ENTITLEMENT_REQUIRED' &&
    typeof (c as { feature?: unknown }).feature === 'string'
  );
}

/** Hebrew label for a feature key, falling back to the raw key. */
export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

/**
 * Upsell card shown when a feature is gated behind a paid plan. Pass either the
 * raw `feature` key or the full `cause`. Renders a Hebrew CTA linking to
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
  const key = cause?.feature ?? feature ?? '';
  const label = featureLabel(key);

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
            <p className="text-sm font-semibold text-ink">{title ?? `שדרגו כדי לפתוח את ${label}`}</p>
            <p className="mt-0.5 text-xs text-muted">
              התכונה הזו זמינה במסלולים בתשלום.
            </p>
          </div>
        </div>
        <Link href="/pricing" className="shrink-0">
          <Button variant="primary" size="sm">
            צפו במסלולים
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
          {title ?? `שדרגו את המנוי כדי לפתוח את ${label}`}
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          {label} זמינה במסלולים בתשלום. שדרגו את החשבון כדי לקבל גישה מלאה.
        </p>
      </div>
      <Link href="/pricing">
        <Button variant="primary">צפו במסלולים ושדרגו</Button>
      </Link>
    </Card>
  );
}

/**
 * Generic (non-entitlement) error surface, Ledger style. Used as the fallback
 * branch when an error is NOT ENTITLEMENT_REQUIRED.
 */
export function ErrorNotice({
  title = 'משהו השתבש',
  message,
  className,
}: {
  title?: React.ReactNode;
  message?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      padding="md"
      className={`flex items-center gap-3 border-danger/30 bg-danger/5 text-danger ${className ?? ''}`}
    >
      <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">{title}</p>
        {message ? <p className="mt-0.5 text-sm text-danger/80">{message}</p> : null}
      </div>
    </Card>
  );
}
