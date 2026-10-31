'use client';

import { useState } from 'react';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, Field, Input } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { localizeServerError } from '@/lib/serverErrors';

export interface LetterheadValues {
  legalName: string;
  businessId: string;
  address: string;
  phone: string;
  email: string;
}

/**
 * "פרטים למכתבי דרישת זיכוי" — the letterhead of the supplier credit-request
 * letters, filled once. Prefilled from the restaurant's name and ח״פ until
 * saved. Owner / manager edit; the bookkeeper sees it read-only.
 */
export function LetterheadForm({ initial, canEdit }: { initial: LetterheadValues; canEdit: boolean }) {
  const t = useT(settings);
  const locale = useLocale();
  const [v, setV] = useState<LetterheadValues>(initial);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const save = trpc.settings.updateLetterhead.useMutation({
    onSuccess: () => setStatus({ ok: true, message: t('letterhead.saved') }),
    onError: (err) => setStatus({ ok: false, message: localizeServerError(err, locale, t('letterhead.failed')) }),
  });
  const set = (k: keyof LetterheadValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    save.mutate({
      legalName: v.legalName.trim(),
      businessId: v.businessId.trim(),
      address: v.address.trim(),
      phone: v.phone.trim(),
      email: v.email.trim(),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="letterhead-form">
      {!canEdit ? (
        <Card padding="md" className="flex items-center gap-3 border-warn/30 bg-warn/5 text-muted">
          <Lock className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          <span>{t('readOnly.letterhead')}</span>
        </Card>
      ) : null}
      <Card flow elevated padding="lg">
        <h3 className="mb-5 text-lg font-bold text-ink">{t('letterhead.cardTitle')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('letterhead.legalName')} htmlFor="lh-name">
            <Input id="lh-name" value={v.legalName} onChange={set('legalName')} disabled={!canEdit} maxLength={200} />
          </Field>
          <Field label={t('letterhead.businessId')} htmlFor="lh-biz" hint={t('letterhead.businessIdHint')}>
            <Input
              id="lh-biz"
              value={v.businessId}
              onChange={set('businessId')}
              disabled={!canEdit}
              inputMode="numeric"
              pattern="\d{9}"
              maxLength={9}
              dir="ltr"
              placeholder="514778123"
            />
          </Field>
          <Field label={t('letterhead.address')} htmlFor="lh-address">
            <Input id="lh-address" value={v.address} onChange={set('address')} disabled={!canEdit} maxLength={300} />
          </Field>
          <Field label={t('letterhead.phone')} htmlFor="lh-phone">
            <Input id="lh-phone" type="tel" value={v.phone} onChange={set('phone')} disabled={!canEdit} maxLength={32} dir="ltr" placeholder="04-8123456" />
          </Field>
          <Field label={t('letterhead.email')} htmlFor="lh-email">
            <Input id="lh-email" type="email" value={v.email} onChange={set('email')} disabled={!canEdit} maxLength={200} dir="ltr" />
          </Field>
        </div>
      </Card>
      {canEdit ? (
        <div className="flex items-center gap-4">
          <Button type="submit" variant="primary" loading={save.isPending} data-testid="letterhead-save">
            {t('letterhead.save')}
          </Button>
          {status ? (
            <p role="status" className={`flex items-center gap-1.5 text-sm font-medium ${status.ok ? 'text-primary' : 'text-danger'}`}>
              {status.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
              {status.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
