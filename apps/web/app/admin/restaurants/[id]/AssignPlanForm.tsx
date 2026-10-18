'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { admin } from '@/lib/i18n/messages/admin';
import { localizeServerError } from '@/lib/serverErrors';

const PLANS = ['trial', 'basic', 'pro', 'chain'] as const;
type PlanKey = (typeof PLANS)[number];

export function AssignPlanForm({
  restaurantId,
  currentPlan,
}: {
  restaurantId: string;
  currentPlan: string | null;
}) {
  const router = useRouter();
  const t = useT(admin);
  const locale = useLocale();
  const [plan, setPlan] = useState<PlanKey>(
    PLANS.includes(currentPlan as PlanKey) ? (currentPlan as PlanKey) : 'pro',
  );
  const assign = trpc.admin.assignPlan.useMutation({
    onSuccess: () => router.refresh(),
  });

  return (
    <div>
      <label
        htmlFor="assign-plan"
        className="mb-2 block font-mono text-xs font-medium uppercase tracking-wider text-subtle"
      >
        {t('assign.label')}
      </label>
      <div className="flex items-center gap-2">
        <select
          id="assign-plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as PlanKey)}
          className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {t(`plans.${p}`)}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => assign.mutate({ restaurantId, planKey: plan })}
          disabled={assign.isPending}
        >
          {assign.isPending ? t('assign.pending') : t('assign.submit')}
        </Button>
      </div>
      {assign.error ? (
        <p className="mt-2 text-xs text-danger">{localizeServerError(assign.error, locale, t('generic'))}</p>
      ) : null}
      {assign.isSuccess ? <p className="mt-2 text-xs text-primary">{t('assign.saved')}</p> : null}
    </div>
  );
}
