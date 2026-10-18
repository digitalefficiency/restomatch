'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { admin } from '@/lib/i18n/messages/admin';
import { localizeServerError } from '@/lib/serverErrors';

const FEATURES = ['integrations', 'whatsapp_alerts', 'advanced_analytics', 'accounting_export'] as const;

type FeatureKey = (typeof FEATURES)[number];

interface Overrides {
  limits?: {
    invoicesPerMonth?: number | null;
    restaurants?: number | null;
    seatsPerRestaurant?: number | null;
  };
  features?: string[];
}

/** Admin override of a tenant's plan limits/features. Empty number = plan default. */
export function OverridesForm({ restaurantId, current }: { restaurantId: string; current: Overrides }) {
  const router = useRouter();
  const t = useT(admin);
  const locale = useLocale();
  const [invoices, setInvoices] = useState(
    current.limits?.invoicesPerMonth != null ? String(current.limits.invoicesPerMonth) : '',
  );
  const [restaurants, setRestaurants] = useState(
    current.limits?.restaurants != null ? String(current.limits.restaurants) : '',
  );
  const [seats, setSeats] = useState(
    current.limits?.seatsPerRestaurant != null ? String(current.limits.seatsPerRestaurant) : '',
  );
  const [features, setFeatures] = useState<string[]>(current.features ?? []);

  const save = trpc.admin.setOverrides.useMutation({ onSuccess: () => router.refresh() });

  function intOrNull(raw: string): number | null {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isInteger(n) && n >= 1 ? n : null;
  }

  function toggle(f: FeatureKey) {
    setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  function submit() {
    save.mutate({
      restaurantId,
      overrides: {
        limits: {
          invoicesPerMonth: intOrNull(invoices),
          restaurants: intOrNull(restaurants),
          seatsPerRestaurant: intOrNull(seats),
        },
        features: features as FeatureKey[],
      },
    });
  }

  const inputCls =
    'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink transition-colors focus:border-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div className="mt-5 border-t border-line pt-5">
      <label className="mb-2 block font-mono text-xs font-medium uppercase tracking-wider text-subtle">
        {t('overrides.label')}
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <span className="mb-1 block text-xs text-subtle">{t('overrides.invoices')}</span>
          <input className={inputCls} inputMode="numeric" value={invoices} onChange={(e) => setInvoices(e.target.value)} />
        </div>
        <div>
          <span className="mb-1 block text-xs text-subtle">{t('overrides.restaurants')}</span>
          <input className={inputCls} inputMode="numeric" value={restaurants} onChange={(e) => setRestaurants(e.target.value)} />
        </div>
        <div>
          <span className="mb-1 block text-xs text-subtle">{t('overrides.seats')}</span>
          <input className={inputCls} inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {FEATURES.map((f) => (
          <label key={f} className="flex items-center gap-1.5 text-sm text-ink">
            <input type="checkbox" checked={features.includes(f)} onChange={() => toggle(f)} />
            {t(`overrides.features.${f}`)}
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={save.isPending}>
          {save.isPending ? t('overrides.saving') : t('overrides.save')}
        </Button>
        {save.error ? (
          <span className="text-xs text-danger">{localizeServerError(save.error, locale, t('generic'))}</span>
        ) : null}
        {save.isSuccess ? <span className="text-xs text-primary">{t('overrides.saved')}</span> : null}
      </div>
    </div>
  );
}
