'use client';

import { useState } from 'react';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { formatNumber, formatPercent } from '@/lib/i18n/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { originalProps } from '@/lib/i18n/original';
import { contracts as contractsNs } from '@/lib/i18n/messages/contracts';
import { components } from '@/lib/i18n/messages/components';
import type { SupplierOption } from './contract-form';
import { percentToFraction } from './logic';

/**
 * Price-alert threshold rules: scope (supplier and/or category, or the
 * restaurant default when both are empty), rise threshold %, window days,
 * enabled. Saving a scope that already has a rule replaces it (server upsert).
 */
export function ThresholdsPanel({ suppliers, canManage }: { suppliers: SupplierOption[]; canManage: boolean }) {
  const t = useT(contractsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const utils = trpc.useUtils();

  const data = trpc.priceAlerts.thresholds.useQuery();
  const save = trpc.priceAlerts.setThreshold.useMutation();
  const remove = trpc.priceAlerts.deleteThreshold.useMutation();

  const [supplierId, setSupplierId] = useState('');
  const [category, setCategory] = useState('');
  const [pct, setPct] = useState('');
  const [windowDays, setWindowDays] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const defaults = data.data?.defaults;
  const supplierLabel = (id: string | null, fallback: string | null) => {
    const s = suppliers.find((x) => x.id === id);
    return s ? displayName(s.name, s.nameEn, locale).primary : (fallback ?? '');
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fraction = percentToFraction(pct || (defaults ? String(defaults.thresholdPct * 100) : ''));
    if (fraction === null) return setError(t('thresholds.errors.threshold'));
    const days = Number(windowDays || defaults?.windowDays || 0);
    if (!Number.isInteger(days) || days < 7 || days > 120) return setError(t('thresholds.errors.window'));
    try {
      await save.mutateAsync({
        supplierId: supplierId || null,
        category: category || null,
        thresholdPct: fraction,
        windowDays: days,
        enabled,
      });
      toast.success(t('thresholds.saved'));
      void utils.priceAlerts.thresholds.invalidate();
      setPct('');
      setWindowDays('');
    } catch (err) {
      setError(friendlyError(err, tc));
    }
  }

  async function del(id: string) {
    if (!window.confirm(t('thresholds.confirmDelete'))) return;
    try {
      await remove.mutateAsync({ id });
      toast.success(t('thresholds.deleted'));
      void utils.priceAlerts.thresholds.invalidate();
    } catch (err) {
      toast.error(friendlyError(err, tc));
    }
  }

  if (data.isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label={t('alerts.loading')}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (data.error || !data.data) {
    return (
      <p role="alert" className="text-sm text-danger">
        {friendlyError(data.error, tc)}
      </p>
    );
  }
  const { rules, categories } = data.data;

  return (
    <div className="space-y-6">
      {defaults ? (
        <p className="text-sm text-muted">
          {t('thresholds.intro', {
            threshold: formatPercent(defaults.thresholdPct, locale, 1),
            days: formatNumber(defaults.windowDays, locale),
          })}
        </p>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState
          icon={<SlidersHorizontal className="h-6 w-6" />}
          title={t('thresholds.emptyTitle')}
          description={t('thresholds.emptyBody')}
        />
      ) : (
        <Card elevated padding="none" flow className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">{t('thresholds.caption')}</caption>
            <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wider text-subtle">
              <tr>
                <th scope="col" className="p-3 text-start font-semibold">{t('thresholds.colScope')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('thresholds.colThreshold')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('thresholds.colWindow')}</th>
                <th scope="col" className="p-3 text-start font-semibold">{t('thresholds.colEnabled')}</th>
                {canManage ? (
                  <th scope="col" className="p-3 text-start font-semibold">
                    <span className="sr-only">{t('thresholds.colActions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const sup = r.supplierId ? supplierLabel(r.supplierId, r.supplierName) : null;
                return (
                  <tr key={r.id} className="border-t border-line transition-colors hover:bg-surface-2/60">
                    <td className="p-3 text-ink">
                      {!sup && !r.category ? (
                        t('thresholds.scopeDefault')
                      ) : (
                        <div className="space-y-0.5">
                          {sup ? <div {...originalProps(sup)}>{t('thresholds.scopeSupplier', { supplier: sup })}</div> : null}
                          {r.category ? (
                            <div className="text-muted">{t('thresholds.scopeCategory', { category: r.category })}</div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-mono tabular-nums text-ink">
                      <bdi dir="ltr">+{formatPercent(r.thresholdPct, locale, 1)}</bdi>
                    </td>
                    <td className="p-3 tabular-nums text-muted">
                      {t('thresholds.days', { count: formatNumber(r.windowDays, locale) })}
                    </td>
                    <td className="p-3">
                      <Badge tone={r.enabled ? 'accent' : 'neutral'}>
                        {r.enabled ? t('thresholds.enabled') : t('thresholds.disabled')}
                      </Badge>
                    </td>
                    {canManage ? (
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          title={t('thresholds.delete')}
                          aria-label={t('thresholds.delete')}
                          disabled={remove.isPending}
                          onClick={() => del(r.id)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {canManage ? (
        <Card elevated flow>
          <form onSubmit={submit} noValidate>
            <h2 className="mb-1 text-base font-semibold text-ink">{t('thresholds.formTitle')}</h2>
            <p className="mb-4 text-xs text-subtle">{t('thresholds.replaceHint')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t('thresholds.supplier')} htmlFor="th-supplier">
                <Select id="th-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">{t('thresholds.anySupplier')}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {displayName(s.name, s.nameEn, locale).primary}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('thresholds.category')} htmlFor="th-category">
                <Select id="th-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">{t('thresholds.anyCategory')}</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('thresholds.threshold')} htmlFor="th-pct">
                <Input
                  id="th-pct"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0.1"
                  max="500"
                  dir="ltr"
                  value={pct}
                  placeholder={defaults ? formatNumber(defaults.thresholdPct * 100, locale) : ''}
                  onChange={(e) => setPct(e.target.value)}
                />
              </Field>
              <Field label={t('thresholds.window')} htmlFor="th-window">
                <Input
                  id="th-window"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min="7"
                  max="120"
                  dir="ltr"
                  value={windowDays}
                  placeholder={defaults ? String(defaults.windowDays) : ''}
                  onChange={(e) => setWindowDays(e.target.value)}
                />
              </Field>
            </div>
            <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-line bg-surface-2 accent-primary"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {t('thresholds.enabledLabel')}
            </label>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-4">
              <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
                {t('thresholds.submit')}
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <p className="text-xs text-subtle">{t('readOnly')}</p>
      )}
    </div>
  );
}
