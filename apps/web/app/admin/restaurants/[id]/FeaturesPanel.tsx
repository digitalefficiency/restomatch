'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { admin } from '@/lib/i18n/messages/admin';
import { localizeServerError } from '@/lib/serverErrors';

/** What admin.getRestaurant reports for one tenant's wave-1 flags. */
export interface FeatureState {
  stored: Record<string, boolean | undefined>;
  all: boolean;
  effective: Record<string, boolean>;
  killed: string[];
}

/** The pilot's feature set (ציקטי go-live). The button ticks these; saving still needs a confirm. */
const PILOT_DEFAULTS = [
  'contracts',
  'recovery',
  'orderCapture',
  'dockSlip',
  'receiverPwa',
  'leakProof',
  'supplierLeakCard',
  'supplierLedger',
  'monthlyReport',
  'monthlyDigestPreview',
] as const;

/** On for this tenant before any kill-switch — what a ticked box means. */
function storedOn(state: FeatureState, key: string): boolean {
  const v = state.stored[key];
  return v === true || (state.all && v !== false);
}

export function FeaturesPanel({ restaurantId, state }: { restaurantId: string; state: FeatureState }) {
  const router = useRouter();
  const t = useT(admin);
  const locale = useLocale();
  const initial = useMemo(
    () => Object.fromEntries(Object.keys(state.effective).map((k) => [k, storedOn(state, k)])),
    [state],
  );
  const keys = Object.keys(initial);
  const [on, setOn] = useState<Record<string, boolean>>(initial);
  const save = trpc.admin.setFeatures.useMutation({ onSuccess: () => router.refresh() });

  const changed = keys.filter((k) => on[k] !== initial[k]);

  function submit() {
    if (changed.length === 0) return;
    const list = changed.map((k) => `${k}: ${on[k] ? '✓' : '✗'}`).join('\n');
    if (!window.confirm(t('features.confirm', { count: changed.length, list }))) return;
    save.mutate({ restaurantId, features: Object.fromEntries(changed.map((k) => [k, on[k] === true])) });
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-1 font-mono text-xs font-semibold uppercase tracking-wider text-subtle">
        {t('features.title')}
      </h2>
      <p className="mb-3 text-xs text-muted">{t('features.hint')}</p>
      {state.all ? (
        <p className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink">
          {t('features.allNote')}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOn((prev) => ({ ...prev, ...Object.fromEntries(PILOT_DEFAULTS.map((k) => [k, true])) }))}
        >
          {t('features.pilotDefaults')}
        </Button>
        <span className="text-xs text-subtle">{t('features.pilotHint')}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead className="border-b border-line font-mono text-xs uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-2 py-2 text-start font-medium">{t('features.colKey')}</th>
              <th className="px-2 py-2 text-start font-medium">{t('features.colOn')}</th>
              <th className="px-2 py-2 text-start font-medium">{t('features.colEffective')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {keys.map((k) => {
              const killed = state.killed.includes(k);
              return (
                <tr key={k}>
                  <td className="px-2 py-1.5">
                    <label htmlFor={`feature-${k}`} className="font-mono text-xs text-ink" dir="ltr">
                      {k}
                    </label>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      id={`feature-${k}`}
                      type="checkbox"
                      checked={on[k] === true}
                      onChange={(e) => setOn((prev) => ({ ...prev, [k]: e.target.checked }))}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {killed ? (
                      <span className="text-warn">{t('features.killed')}</span>
                    ) : state.effective[k] ? (
                      <span className="text-primary">{t('features.effectiveOn')}</span>
                    ) : (
                      <span className="text-subtle">{t('features.effectiveOff')}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={submit} disabled={save.isPending || changed.length === 0}>
          {save.isPending ? t('features.saving') : t('features.save')}
        </Button>
        {changed.length === 0 && !save.isSuccess ? (
          <span className="text-xs text-subtle">{t('features.noChanges')}</span>
        ) : null}
        {save.error ? (
          <span className="text-xs text-danger">{localizeServerError(save.error, locale, t('generic'))}</span>
        ) : null}
        {save.isSuccess ? <span className="text-xs text-primary">{t('features.saved')}</span> : null}
      </div>
    </section>
  );
}
