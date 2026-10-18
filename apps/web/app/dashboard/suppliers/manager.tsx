'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { DeliverySchedule } from '@restomatch/db';
import { Pencil, Plus, Power, Search, Truck } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Spinner,
  displayName,
  friendlyError,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { suppliers as suppliersNs } from '@/lib/i18n/messages/suppliers';
import {
  DAY_KEYS,
  emptyForm,
  matchesSupplierFilter,
  toCreateInput,
  validateSupplierForm,
  type Day,
  type FormState,
} from './form-logic';

/**
 * Locally-declared row shape (the fields this manager uses). Avoids deriving
 * from the tRPC AppRouter output type, whose inference becomes too complex for
 * `inferRouterOutputs[...]` indexing as the router grows.
 */
interface Supplier {
  id: string;
  name: string;
  nameEn: string | null;
  businessId: string | null;
  contactEmail: string | null;
  contactWhatsapp: string | null;
  paymentTerms: string | null;
  deliverySchedule: DeliverySchedule | null;
  active: boolean;
  sourcePlatform: string | null;
}

/** Supplier setup CRUD — list, filter, create, soft-deactivate. */
export function SupplierManager() {
  const t = useT(suppliersNs);
  const tc = useT(components);
  const toast = useToast();
  const utils = trpc.useUtils();
  const list = trpc.suppliers.list.useQuery({ includeInactive: true });
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const invalidate = () => utils.suppliers.list.invalidate();
  const create = trpc.suppliers.create.useMutation({
    onSuccess: (row) => {
      setCreating(false);
      toast.success(t('manager.created', { name: row.name }));
      void invalidate();
    },
  });
  const setActive = trpc.suppliers.setActive.useMutation({
    onSuccess: (row) => {
      toast.success(t(row.active ? 'manager.activated' : 'manager.deactivated', { name: row.name }));
      void invalidate();
    },
    onError: (e) => toast.error(friendlyError(e, tc)),
    onSettled: () => setTogglingId(null),
  });

  const suppliers = useMemo(() => (list.data ?? []) as Supplier[], [list.data]);
  const visible = useMemo(
    () => suppliers.filter((s) => matchesSupplierFilter(s, filter)),
    [suppliers, filter],
  );

  if (list.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted">
        <Spinner className="h-4 w-4" /> {t('manager.loading')}
      </div>
    );
  }
  if (list.isError) {
    return <ErrorNotice message={t('manager.loadError')} />;
  }

  const activeCount = suppliers.filter((s) => s.active).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm tabular-nums text-muted">
          {activeCount === suppliers.length
            ? t('manager.count', { count: suppliers.length })
            : t('manager.countActive', { active: activeCount, count: suppliers.length })}
        </p>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {suppliers.length > 5 ? (
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('manager.filterPlaceholder')}
                aria-label={t('manager.filterLabel')}
                className="ps-9 text-sm"
              />
            </div>
          ) : null}
          {!creating && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {t('manager.add')}
            </Button>
          )}
        </div>
      </div>

      {creating && (
        <SupplierForm
          title={t('form.newTitle')}
          initial={emptyForm}
          submitting={create.isPending}
          error={create.error ? friendlyError(create.error, tc) : null}
          onCancel={() => setCreating(false)}
          onSubmit={(form) => create.mutate(toCreateInput(form))}
        />
      )}

      {suppliers.length === 0 && !creating ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title={t('manager.emptyTitle')}
          description={t('manager.emptyBody')}
          action={
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {t('manager.add')}
            </Button>
          }
        />
      ) : visible.length === 0 && suppliers.length > 0 ? (
        <p className="py-6 text-center text-sm text-subtle">{t('manager.noMatch')}</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((s) => (
            <li key={s.id}>
              <SupplierRow
                supplier={s}
                onToggleActive={() => {
                  setTogglingId(s.id);
                  setActive.mutate({ supplierId: s.id, active: !s.active });
                }}
                toggling={togglingId === s.id}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SupplierRow({
  supplier,
  onToggleActive,
  toggling,
}: {
  supplier: Supplier;
  onToggleActive: () => void;
  toggling: boolean;
}) {
  const t = useT(suppliersNs);
  const locale = useLocale();
  const name = displayName(supplier.name, supplier.nameEn, locale);
  const days = DAY_KEYS.filter((d) => supplier.deliverySchedule?.[d]?.length);
  return (
    <Card as="article" elevated className={supplier.active ? '' : 'opacity-70'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/suppliers/${supplier.id}`}
              className="truncate rounded text-base font-bold text-ink underline-offset-4 hover:text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              {name.primary}
            </Link>
            {name.secondary ? (
              <span className="text-sm text-subtle" lang="he">
                {name.secondary}
              </span>
            ) : null}
            {!supplier.active && <Badge tone="neutral">{t('manager.inactive')}</Badge>}
            {supplier.sourcePlatform && <Badge tone="info">{supplier.sourcePlatform}</Badge>}
          </div>
          <p className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-subtle">
            {supplier.businessId && (
              <span className="tabular-nums">{t('manager.businessId', { id: supplier.businessId })}</span>
            )}
            {supplier.contactEmail && <span dir="ltr">{supplier.contactEmail}</span>}
            {supplier.contactWhatsapp && (
              <span className="tabular-nums">{t('manager.whatsapp', { phone: supplier.contactWhatsapp })}</span>
            )}
            {supplier.paymentTerms && <span>{t('manager.paymentTerms', { terms: supplier.paymentTerms })}</span>}
            {days.length > 0 ? (
              <span>
                {t('manager.delivery', {
                  days: days
                    .map((d) => `${t(`days.${d}`)} ${supplier.deliverySchedule![d]![0]}`)
                    .join(' · '),
                })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/dashboard/suppliers/${supplier.id}`}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition-all hover:border-primary/40 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> {t('manager.edit')}
          </Link>
          <Button variant="ghost" size="sm" loading={toggling} onClick={onToggleActive}>
            <Power className="h-3.5 w-3.5" aria-hidden="true" />
            {supplier.active ? t('manager.deactivate') : t('manager.activate')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Canonical supplier form — used for "new supplier" and the details tab. */
export function SupplierForm({
  title,
  initial,
  submitting,
  error,
  onCancel,
  onSubmit,
  cancelLabel,
}: {
  title: string;
  initial: FormState;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (form: FormState) => void;
  cancelLabel?: string;
}) {
  const t = useT(suppliersNs);
  const [form, setForm] = useState<FormState>(initial);
  const [touched, setTouched] = useState(false);
  const errors = validateSupplierForm(form);
  const set =
    (k: Exclude<keyof FormState, 'schedule'>) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleDay = (day: Day) => () =>
    setForm((f) => {
      const next = { ...f.schedule };
      if (next[day] !== undefined) delete next[day];
      else next[day] = '08:00';
      return { ...f, schedule: next };
    });
  const setDayTime = (day: Day) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, schedule: { ...f.schedule, [day]: e.target.value } }));
  const showErr = (k: 'nameRequired' | 'emailInvalid') => touched && errors.includes(k);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (errors.length === 0) onSubmit(form);
      }}
    >
    <Card elevated flow>
      <h3 className="mb-4 text-base font-bold text-ink">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('form.name')} htmlFor="sup-name">
          <Input
            id="sup-name"
            value={form.name}
            onChange={set('name')}
            required
            maxLength={200}
            placeholder={t('form.namePlaceholder')}
            aria-invalid={showErr('nameRequired') || undefined}
          />
          {showErr('nameRequired') ? (
            <p className="mt-1 text-xs text-danger">{t('form.nameRequired')}</p>
          ) : null}
        </Field>
        <Field label={t('form.nameEn')} htmlFor="sup-name-en" hint={t('form.nameEnHint')}>
          <Input
            id="sup-name-en"
            value={form.nameEn}
            onChange={set('nameEn')}
            maxLength={200}
            dir="ltr"
            lang="en"
            placeholder={t('form.nameEnPlaceholder')}
            aria-describedby="sup-name-en-hint"
          />
        </Field>
        <Field label={t('form.businessId')} htmlFor="sup-biz">
          <Input
            id="sup-biz"
            value={form.businessId}
            onChange={set('businessId')}
            maxLength={32}
            inputMode="numeric"
            dir="ltr"
            placeholder="514…"
          />
        </Field>
        <Field label={t('form.email')} htmlFor="sup-email">
          <Input
            id="sup-email"
            type="email"
            value={form.contactEmail}
            onChange={set('contactEmail')}
            maxLength={200}
            dir="ltr"
            placeholder="orders@supplier.co.il"
            aria-invalid={showErr('emailInvalid') || undefined}
          />
          {showErr('emailInvalid') ? (
            <p className="mt-1 text-xs text-danger">{t('form.emailInvalid')}</p>
          ) : null}
        </Field>
        <Field label={t('form.whatsapp')} htmlFor="sup-wa">
          <Input
            id="sup-wa"
            type="tel"
            value={form.contactWhatsapp}
            onChange={set('contactWhatsapp')}
            maxLength={32}
            dir="ltr"
            placeholder="+9725…"
          />
        </Field>
        <Field label={t('form.paymentTerms')} htmlFor="sup-terms">
          <Input
            id="sup-terms"
            value={form.paymentTerms}
            onChange={set('paymentTerms')}
            maxLength={500}
            placeholder={t('form.paymentTermsPlaceholder')}
          />
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink">{t('form.deliveryTitle')}</legend>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-4">
            {DAY_KEYS.map((d) => {
              const active = form.schedule[d] !== undefined;
              return (
                <div
                  key={d}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    active ? 'border-primary/40 bg-primary/5' : 'border-line'
                  }`}
                >
                  <input
                    id={`sup-day-${d}`}
                    type="checkbox"
                    checked={active}
                    onChange={toggleDay(d)}
                    className="h-4 w-4 accent-primary"
                  />
                  <label htmlFor={`sup-day-${d}`} className="min-w-0 flex-1 truncate text-ink">
                    {t(`days.${d}`)}
                  </label>
                  {active ? (
                    <input
                      type="time"
                      value={form.schedule[d] ?? ''}
                      onChange={setDayTime(d)}
                      aria-label={t(`days.${d}`)}
                      className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-ink tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-subtle">{t('form.deliveryHint')}</p>
        </fieldset>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={submitting}>
          {t('form.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setForm(initial);
            setTouched(false);
            onCancel();
          }}
        >
          {cancelLabel ?? t('form.cancel')}
        </Button>
      </div>
    </Card>
    </form>
  );
}
