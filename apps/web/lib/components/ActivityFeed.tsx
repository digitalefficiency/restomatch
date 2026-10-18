'use client';

import { CheckCircle2, FileCheck2, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { components } from '@/lib/i18n/messages/components';
import { localizeActivity } from './activityText';
import { cn } from './cn';

export interface ActivityItem {
  id: string;
  eventType: string;
  title: string;
  detail: string | null;
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

/** Recent-activity timeline (localized titles + Israel-time timestamps). */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const locale = useLocale();
  const t = useT(components);
  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-subtle">{t('activity.empty')}</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((e) => {
        const m = META[e.eventType] ?? {
          icon: <FileCheck2 className="h-4 w-4" />,
          tone: 'text-muted bg-surface-2 ring-line',
        };
        const text = localizeActivity(e, locale);
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
                <p className="truncate text-sm font-medium text-ink">{text.title}</p>
                <time
                  dateTime={new Date(e.createdAt).toISOString()}
                  className="shrink-0 font-mono text-xs tabular-nums text-subtle"
                >
                  {formatDate(e.createdAt, locale, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              {text.detail ? <p className="truncate text-xs text-muted">{text.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
