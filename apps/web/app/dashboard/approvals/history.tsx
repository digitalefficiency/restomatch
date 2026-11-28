'use client';

/**
 * "היסטוריה" in the evidence of the current gap (DS3-04 spec §4.4, §5.10; moved from desk.tsx:204-263): the last
 * three audit rows of the gap — who, role, when, decision, note — loaded only when the disclosure opens.
 *
 * The one view with its own read: `approvals.history` (read-only, `limit: 3`, 30 s stale, enabled on open), as
 * desk.tsx had it. The spec keeps the props to `{ id }` and the controller holds no history, so the query moved with
 * the component. The evidence body is keyed by the gap, so the disclosure starts closed for every gap.
 */
import { useState } from 'react';
import { History } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { useT } from '@/lib/i18n/client';
import { approvals } from '@/lib/i18n/messages/approvals';
import type { he as approvalsHe } from '@/lib/i18n/messages/approvals/he';
import type { MessageKey } from '@/lib/i18n/translate';
import { DateTime } from '@/lib/components/money/DateTime';

const DECISION_OF: Record<string, MessageKey<typeof approvalsHe>> = {
  'discrepancy.approved': 'decision.approved',
  'discrepancy.rejected': 'decision.rejected',
  'discrepancy.escalated': 'decision.escalated',
  'discrepancy.reopened': 'decision.reopened',
};

/** "היסטוריה": the last 3 audit rows (who, role, when, decision, note), loaded on open. */
export function HistoryDisclosure({ id }: { id: string }) {
  const t = useT(approvals);
  const [open, setOpen] = useState(false);
  const q = trpc.approvals.history.useQuery({ discrepancyId: id, limit: 3 }, { enabled: open, staleTime: 30_000 });
  const role = (r: string | undefined) => {
    if (!r) return null;
    const out = t(`roles.${r}` as MessageKey<typeof approvalsHe>);
    return out.startsWith('roles.') ? r : out;
  };
  return (
    <details
      className="mt-2 text-body-sm"
      data-testid="approval-history"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-control text-body-sm text-fg-secondary">
        <History className="h-4 w-4" aria-hidden="true" />
        {t('desk.history')}
      </summary>
      {!open ? null : q.isLoading ? (
        <p role="status" className="text-xs text-subtle">
          {t('desk.historyLoading')}
        </p>
      ) : q.isError ? (
        <p role="alert" className="text-xs text-danger">
          {t('desk.historyError')}{' '}
          <button type="button" className="touch-target underline" onClick={() => void q.refetch()}>
            {t('desk.historyRetry')}
          </button>
        </p>
      ) : !q.data?.length ? (
        <p className="text-xs text-subtle">{t('desk.historyEmpty')}</p>
      ) : (
        <ol className="space-y-1 text-xs text-muted">
          {q.data.map((a) => {
            const after = (a.after ?? {}) as { role?: string; fromRole?: string; note?: string | null; reason?: string | null };
            const what = DECISION_OF[a.action] ? t(DECISION_OF[a.action]!) : t('desk.historyCreated');
            const who = [a.actorName ?? t('card.someone'), role(after.role ?? after.fromRole)].filter(Boolean).join(' · ');
            const note = after.reason ?? after.note;
            return (
              <li key={a.id}>
                <bdi>{who}</bdi> · <DateTime value={a.at} variant="datetime" /> · {what}
                {note ? (
                  <>
                    {' · '}
                    <bdi>{note}</bdi>
                  </>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </details>
  );
}
