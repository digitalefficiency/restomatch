'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog, cn, useToast } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { automations as ns } from '@/lib/i18n/messages/automations';
import { localizeServerError } from '@/lib/serverErrors';
import { trpc } from '@/lib/trpc/client';
import { AutomationRowBody, itemText, rolesText, type AutomationRowView } from './rows';

export function AutomationsList({ rows, canEdit }: { rows: AutomationRowView[]; canEdit: boolean }) {
  const t = useT(ns);
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<AutomationRowView | null>(null);
  const save = trpc.automations.setEnabled.useMutation({
    onSuccess: (out) => {
      toast.success(out.killed ? t('confirm.killedNote') : t('confirm.saved'));
      setPending(null);
      router.refresh();
    },
    onError: (err) => {
      toast.error(localizeServerError(err, locale));
      setPending(null);
    },
  });

  const turningOn = pending ? !pending.on : false;
  const name = pending ? itemText(t, pending.key, 'name') : '';

  return (
    <>
      {!canEdit ? <p className="mb-4 text-sm text-muted">{t('page.readOnly')}</p> : null}
      <ul className="space-y-3">
        {rows.map((row) => {
          const switchable = canEdit && row.controllable && !row.killed && !row.blockedBy;
          return (
            <AutomationRowBody
              key={row.key}
              row={row}
              control={
                canEdit && row.controllable && row.controlKey ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.on}
                    aria-label={t('row.switchLabel', {
                      name: itemText(t, row.key, 'name'),
                      state: row.on ? t('row.on') : t('row.off'),
                    })}
                    disabled={!switchable || save.isPending}
                    onClick={() => setPending(row)}
                    className={cn(
                      'inline-flex min-h-11 min-w-16 items-center rounded-full p-1 transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                      'disabled:cursor-not-allowed disabled:opacity-60',
                      row.on ? 'justify-end bg-primary' : 'justify-start bg-surface-2 ring-1 ring-line',
                    )}
                  >
                    <span aria-hidden className="block size-7 rounded-full bg-surface shadow-card" />
                  </button>
                ) : undefined
              }
            />
          );
        })}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        danger={false}
        loading={save.isPending}
        title={turningOn ? t('confirm.onTitle', { name }) : t('confirm.offTitle', { name })}
        body={
          pending
            ? turningOn
              ? t('confirm.onBody', {
                  roles: rolesText(pending.audience, locale),
                  when: itemText(t, pending.key, 'when'),
                })
              : t('confirm.offBody', { roles: rolesText(pending.audience, locale) })
            : null
        }
        confirmLabel={turningOn ? t('confirm.on') : t('confirm.off')}
        cancelLabel={t('confirm.cancel')}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (!pending?.controlKey) return;
          save.mutate({ key: pending.controlKey, on: turningOn, clientMutationId: crypto.randomUUID() });
        }}
      />
    </>
  );
}
