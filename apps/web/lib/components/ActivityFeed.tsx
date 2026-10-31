'use client';

import Link from 'next/link';
import { CheckCircle2, FileCheck2, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDateTime, formatRelative } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { originalProps } from '@/lib/i18n/original';
import { activityHref, activityInvoiceNumber, groupActivity, localizeActivity } from './activityText';
import { cn } from './cn';

export interface ActivityItem {
  id: string;
  eventType: string;
  title: string;
  detail: string | null;
  /** Structured fields (v2: everything the row says). Rendered in every locale. */
  metadata?: unknown;
  /** Who did it, when the feed carries it (G-07). The chip renders only when present. */
  actorName?: string | null;
  createdAt: Date | string;
}

const META: Record<string, { icon: React.ReactNode; tone: string }> = {
  invoice_matched: {
    icon: <FileCheck2 className="h-4 w-4" />,
    tone: 'text-info bg-info/12 ring-info/25',
  },
  invoice_received: {
    icon: <FileCheck2 className="h-4 w-4" />,
    tone: 'text-primary bg-primary/12 ring-primary/25',
  },
  discrepancy_approved: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    tone: 'text-primary bg-primary/12 ring-primary/25',
  },
  discrepancy_rejected: {
    icon: <XCircle className="h-4 w-4" />,
    tone: 'text-danger bg-danger/12 ring-danger/25',
  },
  alias_learned: {
    icon: <Sparkles className="h-4 w-4" />,
    tone: 'text-gold bg-gold/12 ring-gold/25',
  },
  sync_completed: {
    icon: <RefreshCw className="h-4 w-4" />,
    tone: 'text-primary bg-primary/12 ring-primary/25',
  },
};

/**
 * Recent-activity timeline (W2-13): one row per object (an invoice's "received" and
 * "matched" collapse into one), each linked to its invoice, with relative time and
 * an actor chip when supplied. Text comes from metadata via `localizeActivity`.
 */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const locale = useLocale();
  const t = useT(components);
  const rows = groupActivity(items);
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-subtle">{t('activity.empty')}</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((e) => {
        const m = META[e.eventType] ?? {
          icon: <FileCheck2 className="h-4 w-4" />,
          tone: 'text-muted bg-surface-2 ring-line',
        };
        const text = localizeActivity(e, locale);
        const href = activityHref(e);
        const number = activityInvoiceNumber(e);
        const when = new Date(e.createdAt);
        return (
          <li key={e.id} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1',
                m.tone,
              )}
            >
              {m.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                {href ? (
                  <Link
                    href={href}
                    title={text.title}
                    aria-label={number ? `${text.title} · ${t('feed.openInvoice', { number })}` : undefined}
                    className="truncate text-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {text.title}
                  </Link>
                ) : (
                  <p className="truncate text-sm font-medium text-ink" title={text.title}>
                    {text.title}
                  </p>
                )}
                <time
                  dateTime={when.toISOString()}
                  title={formatDateTime(when, locale)}
                  suppressHydrationWarning
                  className="shrink-0 text-xs tabular-nums text-subtle"
                >
                  {formatRelative(when, locale)}
                </time>
              </div>
              {text.detail || e.actorName ? (
                <p className="truncate text-xs text-muted" title={text.detail ?? undefined}>
                  {e.actorName ? (
                    <span className="me-1.5 inline-block rounded-md bg-surface-2 px-1.5 text-subtle">
                      {t('feed.byActor', { actor: e.actorName })}
                    </span>
                  ) : null}
                  {/* Parts left in Hebrew (supplier names, free-text reasons) are originals. */}
                  {text.detail?.split(' · ').map((part, i) => (
                    <span key={i}>
                      {i > 0 ? ' · ' : null}
                      <span {...originalProps(part)}>{part}</span>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
