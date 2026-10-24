'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import {
  Button,
  Card,
  EntitlementUpsell,
  ErrorNotice,
  Field,
  Input,
  Spinner,
  displayName,
  entitlementCauseOf,
  friendlyError,
  useSingleFlight,
  useToast,
} from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { components } from '@/lib/i18n/messages/components';
import { integrations as integrationsNs } from '@/lib/i18n/messages/integrations';
import { mappingPayload, mappingProblems, type MappingForm } from './logic';

/** Chart-of-accounts codes for the accounting files. Owner edits; bookkeeper reads. */
export function AccountingMapping({ canEdit }: { canEdit: boolean }) {
  const t = useT(integrationsNs);
  const tc = useT(components);
  const locale = useLocale();
  const toast = useToast();
  const once = useSingleFlight();
  const q = trpc.integrations.accountingConfig.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.integrations.setAccountingConfig.useMutation();
  const [form, setForm] = useState<MappingForm | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (q.data && form === null) {
      setForm({
        expenseAccount: q.data.config.expenseAccount,
        vatInputAccount: q.data.config.vatInputAccount,
        movementType: q.data.config.movementType,
        supplierAccounts: Object.fromEntries(q.data.suppliers.map((s) => [s.id, s.account ?? ''])),
      });
    }
  }, [q.data, form]);

  const ent = entitlementCauseOf(q.error);
  const problems = form ? mappingProblems(form) : {};
  const err = (key: string) => (touched && problems[key] ? t(`accounting.mapping.${problems[key]!}`) : undefined);

  function submit() {
    setTouched(true);
    if (!form || Object.keys(problems).length > 0) return;
    once(async () => {
      try {
        await save.mutateAsync(mappingPayload(form));
        toast.success(t('accounting.mapping.saved'));
        await utils.integrations.accountingConfig.invalidate();
      } catch (e) {
        toast.error(friendlyError(e, tc));
      }
    });
  }

  return (
    <section id="accounting" aria-labelledby="int-acc-title" className="scroll-mt-24">
      <h2 id="int-acc-title" className="mb-1 flex items-center gap-2 text-lg font-bold text-ink">
        <Settings2 className="h-5 w-5 text-primary" aria-hidden="true" /> {t('accounting.mapping.title')}
      </h2>
      <p className="mb-3 text-sm text-muted">{t('accounting.mapping.body')}</p>
      {ent ? (
        <EntitlementUpsell cause={ent} className="max-w-2xl" />
      ) : q.isError ? (
        <ErrorNotice message={friendlyError(q.error, tc)} />
      ) : !form || !q.data ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Card elevated flow>
            {!canEdit ? <p className="mb-3 text-xs text-subtle">{t('accounting.mapping.readOnly')}</p> : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(
                [
                  ['expenseAccount', 'expense'],
                  ['vatInputAccount', 'vat'],
                  ['movementType', 'movement'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={t(`accounting.mapping.${label}`)} htmlFor={`acc-${key}`} hint={err(key)}>
                  <Input
                    id={`acc-${key}`}
                    value={form[key]}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    aria-invalid={!!err(key) || undefined}
                    maxLength={key === 'movementType' ? 3 : 15}
                    dir="auto"
                    className="font-mono"
                  />
                </Field>
              ))}
            </div>

            <h3 className="mt-6 text-sm font-bold text-ink">{t('accounting.mapping.suppliersTitle')}</h3>
            <p className="mb-2 text-xs text-subtle">{t('accounting.mapping.suppliersBody')}</p>
            {q.data.suppliers.length === 0 ? (
              <p className="text-sm text-subtle">{t('accounting.mapping.noSuppliers')}</p>
            ) : (
              <ul className="divide-y divide-line/60 rounded-xl border border-line">
                {q.data.suppliers.map((s) => {
                  const name = displayName(s.name, s.nameEn, locale);
                  const id = `acc-sup-${s.id}`;
                  return (
                    <li key={s.id} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                      <label htmlFor={id} className="min-w-0 flex-1 text-sm text-ink">
                        <span className="block truncate" lang={name.secondary ? undefined : 'he'} dir="auto">
                          {name.primary}
                        </span>
                        {name.secondary ? (
                          <span className="block truncate text-xs text-subtle" lang="he">
                            {name.secondary}
                          </span>
                        ) : null}
                      </label>
                      <Input
                        id={id}
                        value={form.supplierAccounts[s.id] ?? ''}
                        placeholder={s.defaultAccount}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setForm({ ...form, supplierAccounts: { ...form.supplierAccounts, [s.id]: e.target.value } })
                        }
                        aria-invalid={!!err(`supplier:${s.id}`) || undefined}
                        aria-label={`${t('accounting.mapping.account')}: ${name.primary}`}
                        maxLength={15}
                        dir="ltr"
                        className="font-mono sm:w-44"
                      />
                      {err(`supplier:${s.id}`) ? (
                        <p className="text-xs text-danger">{err(`supplier:${s.id}`)}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? (
              <div className="mt-4">
                <Button type="submit" variant="primary" size="sm" loading={save.isPending}>
                  {t('accounting.mapping.save')}
                </Button>
              </div>
            ) : null}
          </Card>
        </form>
      )}
    </section>
  );
}
