'use client';

import { useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { leaks } from '@/lib/i18n/messages/leaks';
import { approvals } from '@/lib/i18n/messages/approvals';
import { trpc } from '@/lib/trpc/client';
import { resolutionLabel } from '../../approvals/vocab';

const VERBS = ['created', 'approved', 'rejected', 'escalated'] as const;
const ROLES = ['owner', 'manager', 'bookkeeper', 'receiver', 'chef'] as const;

/**
 * W2-09c · leaks-33: who did what to this line, newest first — loaded only when
 * the owner opens it (one small query per opened line, never N on page load).
 * Each entry: who + role chip, verb, before→after, dd.MM.yyyy HH:mm (Asia/Jerusalem).
 */
export function LineHistory({ discrepancyId }: { discrepancyId: string }) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();
  const t = useT(leaks);
  const ta = useT(approvals);
  const q = trpc.owner.lineHistory.useQuery({ discrepancyId, limit: 3 }, { enabled: open, staleTime: 60_000 });

  return (
    <details className="mt-1 text-xs" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="line-history">
      <summary className="inline-flex min-h-6 cursor-pointer items-center font-medium text-primary">{t('breakdown.history.toggle')}</summary>
      <div className="mt-1 ps-3" aria-live="polite">
        {!open ? null : q.isLoading ? (
          <p className="text-muted">{t('breakdown.history.loading')}</p>
        ) : q.isError ? (
          <p className="text-muted">
            {t('breakdown.history.error')}{' '}
            <button type="button" className="font-medium text-primary underline" onClick={() => void q.refetch()}>
              {t('breakdown.history.retry')}
            </button>
          </p>
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-muted">{t('breakdown.history.empty')}</p>
        ) : (
          <ol className="space-y-1">
            {q.data.map((e, i) => {
              const verb = VERBS.find((v) => e.action === `discrepancy.${v}`) ?? 'other';
              const role = ROLES.find((r) => r === e.userRole);
              return (
                <li key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-x-2 text-muted">
                  <span className="font-medium text-ink">{e.userName ?? t('breakdown.history.system')}</span>
                  {role ? (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted ring-1 ring-line">
                      {t(`breakdown.history.role.${role}`)}
                    </span>
                  ) : null}
                  <span>{t(`breakdown.history.verb.${verb}`)}</span>
                  {e.before && e.after ? (
                    <span>
                      {resolutionLabel(ta, e.before)} → {resolutionLabel(ta, e.after)}
                    </span>
                  ) : null}
                  <time dateTime={e.at} className="tabular-nums">
                    <bdi>
                      {formatDate(e.at, locale, {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        hour12: false, timeZone: 'Asia/Jerusalem',
                      })}
                    </bdi>
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </details>
  );
}
