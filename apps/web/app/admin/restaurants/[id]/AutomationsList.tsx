'use client';

import { Skeleton } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { automations as ns } from '@/lib/i18n/messages/automations';
import { trpc } from '@/lib/trpc/client';
import { AutomationRowBody } from '@/app/dashboard/settings/automations/rows';

/**
 * AU-01 · read-only: the automations the owner sees for this tenant
 * (automations.listForAdmin, audited like the other console reads). Flags are
 * still edited only in FeaturesPanel.
 */
export function AutomationsList({ restaurantId }: { restaurantId: string }) {
  const t = useT(ns);
  const q = trpc.automations.listForAdmin.useQuery({ restaurantId });
  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-subtle">{t('page.adminTitle')}</h2>
      <p className="mb-3 text-xs text-muted">{t('page.adminHint')}</p>
      {q.data ? (
        <ul className="space-y-3">
          {q.data.rows.map((row) => (
            <AutomationRowBody key={row.key} row={row} />
          ))}
        </ul>
      ) : q.error ? (
        <p className="text-sm text-danger">{q.error.message}</p>
      ) : (
        <Skeleton className="h-24" />
      )}
    </section>
  );
}
