'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDate } from '@/lib/i18n/format';
import { admin } from '@/lib/i18n/messages/admin';
import { localizeServerError } from '@/lib/serverErrors';
import { StagedChange } from '../../_components/StagedChange';
import { changedFields, type StagedField } from '../../_components/staged';

const PLANS = ['trial', 'basic', 'pro', 'chain'] as const;
type PlanKey = (typeof PLANS)[number];
const STATUSES = ['active', 'trialing'] as const;
type Status = (typeof STATUSES)[number];
const DEFAULT_TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The same rule as admin.assignPlan: a trialing plan ends `days` whole days from `now`. */
function trialEnd(now: number, days: number): Date {
  return new Date(now + days * DAY_MS);
}

export function AssignPlanForm({
  restaurantId,
  currentPlan,
  currentStatus,
}: {
  restaurantId: string;
  currentPlan: string | null;
  currentStatus: string | null;
}) {
  const router = useRouter();
  const t = useT(admin);
  const locale = useLocale();
  const [plan, setPlan] = useState<PlanKey>(
    PLANS.includes(currentPlan as PlanKey) ? (currentPlan as PlanKey) : 'pro',
  );
  const [status, setStatus] = useState<Status>(currentStatus === 'trialing' ? 'trialing' : 'active');
  const [days, setDays] = useState(String(DEFAULT_TRIAL_DAYS));
  // The preview depends on the clock and the browser's date formatting: compute it
  // after mount only, so the server render never disagrees with the client.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  // W3-07a: "שיוך" stages the change; the write happens only on confirm, with a reason.
  const [staged, setStaged] = useState<StagedField[] | null>(null);
  const assign = trpc.admin.assignPlan.useMutation({
    onSuccess: () => {
      setStaged(null);
      router.refresh();
    },
  });

  const trialDays = Number(days);
  const daysValid = Number.isInteger(trialDays) && trialDays >= 1 && trialDays <= 365;
  const selectCls =
    'rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  const labelCls = 'mb-1 block text-xs text-subtle';

  function stage() {
    if (status === 'trialing' && !daysValid) return;
    const planLabel = (k: string | null) => (k ? t(`plans.${k}` as 'plans.trial') : '');
    const statusLabel = (k: string | null) => (k ? t(`statuses.${k}` as 'statuses.active') : '');
    const fields: StagedField[] = [
      { key: 'plan', label: t('staged.fieldPlan'), before: planLabel(currentPlan), after: planLabel(plan) },
      { key: 'status', label: t('staged.fieldStatus'), before: statusLabel(currentStatus), after: statusLabel(status) },
    ];
    if (status === 'trialing') {
      fields.push({ key: 'trialDays', label: t('staged.fieldTrialDays'), before: '', after: String(trialDays) });
    }
    // Re-assigning the same plan still resets the trial clock, so a same-value
    // staging shows every field rather than "nothing to save".
    const diff = changedFields(fields);
    setStaged(diff.length ? diff : fields);
    assign.reset();
  }

  function confirm(reason: string) {
    if (status === 'trialing') {
      if (!daysValid) return;
      assign.mutate({ restaurantId, planKey: plan, status, trialDays, reason });
    } else {
      assign.mutate({ restaurantId, planKey: plan, status, reason });
    }
  }

  function cancel() {
    setStaged(null);
    setPlan(PLANS.includes(currentPlan as PlanKey) ? (currentPlan as PlanKey) : 'pro');
    setStatus(currentStatus === 'trialing' ? 'trialing' : 'active');
    setDays(String(DEFAULT_TRIAL_DAYS));
  }

  return (
    <div>
      <span className="mb-2 block text-xs font-semibold text-subtle">
        {t('assign.label')}
      </span>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="assign-plan" className={labelCls}>
            {t('detail.plan')}
          </label>
          <select
            id="assign-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as PlanKey)}
            disabled={staged !== null}
            className={selectCls}
          >
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {t(`plans.${p}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="assign-status" className={labelCls}>
            {t('assign.status')}
          </label>
          <select
            id="assign-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            disabled={staged !== null}
            className={selectCls}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </div>
        {status === 'trialing' ? (
          <div>
            <label htmlFor="assign-days" className={labelCls}>
              {t('assign.trialDays')}
            </label>
            <input
              id="assign-days"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={staged !== null}
              aria-invalid={!daysValid}
              className={`${selectCls} w-24`}
            />
          </div>
        ) : null}
        {staged === null ? (
          <Button size="sm" variant="secondary" onClick={stage} disabled={status === 'trialing' && !daysValid}>
            {t('staged.review')}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {status !== 'trialing'
          ? t('assign.noEnd')
          : !daysValid
            ? t('assign.daysInvalid')
            : now === null
              ? null
              : t('assign.endsOn', { date: formatDate(trialEnd(now, trialDays), locale, { dateStyle: 'full' }) })}
      </p>
      {staged ? (
        <StagedChange
          fields={staged}
          pending={assign.isPending}
          error={assign.error ? localizeServerError(assign.error, locale, t('generic')) : null}
          onConfirm={confirm}
          onCancel={cancel}
        />
      ) : null}
      {assign.isSuccess ? <p className="mt-2 text-xs text-primary">{t('assign.saved')}</p> : null}
    </div>
  );
}
