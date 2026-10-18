'use client';

import { useState, useTransition } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { Button, Card, Field, Input, useToast } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { chain } from '@/lib/i18n/messages/chain';
import { originalProps, WithOriginal } from '@/lib/i18n/original';
import { addBranchAction, renameBranchAction, type BranchActionError } from '../branch-actions';
import { SwitchBranchButton } from '../chain/switch-button';

type ErrorKey = `errors.${BranchActionError}`;
const errKey = (e: BranchActionError): ErrorKey => `errors.${e}`;

export function RenameBranch({ restaurantId, name }: { restaurantId: string; name: string }) {
  const t = useT(chain);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(name);
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-base font-semibold text-ink" {...originalProps(current)}>{current}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${t('branches.list.rename')}: ${current}`}
          className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await renameBranchAction(restaurantId, value.trim()).catch(() => ({ ok: false as const, error: 'generic' as const }));
          if (res.ok) {
            // Local state, not router.refresh(): a same-route RSC refetch stalled
            // in the production build (reports/chain.md).
            setCurrent(value.trim());
            toast.success(t('branches.list.renamed'));
            setEditing(false);
          } else toast.error(t(errKey(res.error)));
        });
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        minLength={2}
        maxLength={120}
        required
        autoFocus
        aria-label={t('branches.list.name')}
        className="max-w-xs"
      />
      <Button type="submit" size="sm" loading={pending} aria-label={t('branches.list.save')}>
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} aria-label={t('branches.list.cancel')}>
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </form>
  );
}

export function AddBranchForm({ currentBranch }: { currentBranch: string }) {
  const t = useT(chain);
  const toast = useToast();
  const [name, setName] = useState('');
  const [copySuppliers, setCopySuppliers] = useState(true);
  const [copyCatalog, setCopyCatalog] = useState(true);
  const [copySettings, setCopySettings] = useState(true);
  const [pending, start] = useTransition();

  return (
    <Card elevated padding="lg" className="border-primary/20">
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
        <Plus className="h-5 w-5 text-primary" aria-hidden="true" />
        {t('branches.add.title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('branches.add.body')}</p>
      <form
        className="mt-5 space-y-4"
        data-testid="add-branch-form"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await addBranchAction({ name: name.trim(), copySuppliers, copyCatalog, copySettings }).catch(
              () => ({ ok: false as const, error: 'generic' as const }),
            );
            if (res.ok) {
              // A full navigation re-renders the list server-side (a router.refresh()
              // same-route RSC refetch stalled in the production build).
              window.location.assign(
                `/dashboard/branches?created=${res.restaurantId}&suppliers=${res.suppliers}&products=${res.products}`,
              );
              return;
            }
            toast.error(t(errKey(res.error)));
          });
        }}
      >
        <Field label={t('branches.add.name')} htmlFor="branch-name">
          <Input
            id="branch-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('branches.add.namePlaceholder')}
            minLength={2}
            maxLength={120}
            required
          />
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-muted">
            {t('branches.add.copyFrom')}{' '}
            <span className="font-semibold text-ink" {...originalProps(currentBranch)}>{currentBranch}</span>
          </legend>
          {(
            [
              ['copySuppliers', copySuppliers || copyCatalog, setCopySuppliers, copyCatalog],
              ['copyCatalog', copyCatalog, setCopyCatalog, false],
              ['copySettings', copySettings, setCopySettings, false],
            ] as const
          ).map(([key, checked, set, locked]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={(e) => set(e.target.checked)}
                className="h-4 w-4 rounded border-line accent-primary"
              />
              {t(`branches.add.${key}`)}
            </label>
          ))}
        </fieldset>
        <Button type="submit" loading={pending} data-testid="add-branch-submit">
          {pending ? t('branches.add.submitting') : t('branches.add.submit')}
        </Button>
      </form>
    </Card>
  );
}

/** Success card after a branch was opened (rendered from the server list, so the id is the caller's own). */
export function BranchCreated({
  restaurantId,
  name,
  suppliers,
  products,
}: {
  restaurantId: string;
  name: string;
  suppliers: number;
  products: number;
}) {
  const t = useT(chain);
  return (
    <div
      className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="branch-created"
    >
      <div className="text-sm">
        <p className="font-semibold text-ink">
          <WithOriginal text={t('branches.add.created', { name })} value={name} />
        </p>
        <p className="text-muted">{t('branches.add.createdCopied', { suppliers, products })}</p>
      </div>
      <SwitchBranchButton restaurantId={restaurantId} label={t('branches.add.goThere')} variant="primary" />
    </div>
  );
}
