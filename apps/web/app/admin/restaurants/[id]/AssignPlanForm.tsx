'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';

const PLANS = [
  { key: 'trial', label: 'ניסיון' },
  { key: 'basic', label: 'בסיס' },
  { key: 'pro', label: 'מקצועי' },
  { key: 'chain', label: 'רשת' },
] as const;

export function AssignPlanForm({
  restaurantId,
  currentPlan,
}: {
  restaurantId: string;
  currentPlan: string | null;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<(typeof PLANS)[number]['key']>(
    (currentPlan as (typeof PLANS)[number]['key']) ?? 'pro',
  );
  const assign = trpc.admin.assignPlan.useMutation({
    onSuccess: () => router.refresh(),
  });

  return (
    <div>
      <label className="mb-2 block font-mono text-xs font-medium uppercase tracking-wider text-subtle">
        שיוך תוכנית
      </label>
      <div className="flex items-center gap-2">
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as (typeof PLANS)[number]['key'])}
          className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {PLANS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={() => assign.mutate({ restaurantId, planKey: plan })}
          disabled={assign.isPending}
        >
          {assign.isPending ? 'משייך…' : 'שייך'}
        </Button>
      </div>
      {assign.error ? (
        <p className="mt-2 text-xs text-danger">{assign.error.message}</p>
      ) : null}
      {assign.isSuccess ? <p className="mt-2 text-xs text-primary">נשמר ✓</p> : null}
    </div>
  );
}
