'use client';

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@restomatch/api';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Card, ConfirmDialog, Field, Input, Select, normalizeDecimal } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { localizeServerError } from '@/lib/serverErrors';

type Profile = inferRouterOutputs<AppRouter>['settings']['profile'];

export function ProfileForm({ initial, canEdit }: { initial: Profile; canEdit: boolean }) {
  const t = useT(settings);
  const locale = useLocale();
  const [name, setName] = useState(initial.name);
  const [businessId, setBusinessId] = useState(initial.businessId ?? '');
  // VAT is read-only here (W2-14): it changes the leak ₪ of every invoice whose
  // VAT is derived, so it changes only through the "שנו…" dialog that says so.
  const [vatRate, setVatRate] = useState(initial.vatRate);
  const [vatOpen, setVatOpen] = useState(false);
  const [vatDraft, setVatDraft] = useState('');
  const vatPct = Math.round(vatRate * 1000) / 10;
  const vatDraftCanon = normalizeDecimal(vatDraft);
  const vatDraftNum = vatDraftCanon === null ? NaN : Number(vatDraftCanon);
  const vatDraftValid = Number.isFinite(vatDraftNum) && vatDraftNum >= 0 && vatDraftNum <= 100;
  const [timezone, setTimezone] = useState(initial.timezone);
  /** Israel only (owner decision): the one zone, plus a legacy stored value if any. */
  const timezones = timezone === 'Asia/Jerusalem' ? ['Asia/Jerusalem'] : ['Asia/Jerusalem', timezone];
  const updateVat = trpc.settings.updateProfile.useMutation({
    onSuccess: (res) => {
      setVatRate(res.vatRate);
      setVatOpen(false);
      setStatus({ ok: true, message: t('profile.saved') });
    },
    onError: (err) => setStatus({ ok: false, message: localizeServerError(err, locale, t('profile.failed')) }),
  });
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const update = trpc.settings.updateProfile.useMutation({
    onSuccess: () => setStatus({ ok: true, message: t('profile.saved') }),
    onError: (err) => setStatus({ ok: false, message: localizeServerError(err, locale, t('profile.failed')) }),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    update.mutate({
      name: name.trim(),
      businessId: businessId.trim() || null,
      timezone: timezone.trim(),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {!canEdit ? (
        <Card padding="md" className="flex items-center gap-3 border-warn/30 bg-warn/5 text-muted">
          <Lock className="h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
          <span>{t('readOnly.profile')}</span>
        </Card>
      ) : null}

      <Card flow elevated padding="lg">
        <h3 className="mb-1 text-lg font-bold text-ink">{t('profile.cardTitle')}</h3>
        <p className="mb-5 text-sm text-muted">
          {t('profile.cardSubtitle')}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('profile.name')} htmlFor="prof-name">
            <Input
              id="prof-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              required
              minLength={1}
              maxLength={200}
            />
          </Field>
          <Field label={t('profile.businessId')} htmlFor="prof-biz">
            <Input
              id="prof-biz"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              disabled={!canEdit}
              inputMode="numeric"
              maxLength={32}
              placeholder="514778123"
            />
          </Field>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">{t('profile.vat')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-ink" data-testid="vat-readonly">
                <bdi className="num font-semibold">{vatPct}%</bdi> ·{' '}
                {vatRate === 0.18 ? t('profile.vatNational') : t('profile.vatCustom')}
              </p>
              {canEdit ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setVatDraft(String(vatPct));
                    setVatOpen(true);
                  }}
                >
                  {t('profile.vatChange')}
                </Button>
              ) : null}
            </div>
          </div>
          <Field label={t('profile.timezone')} htmlFor="prof-tz">
            <Select
              id="prof-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              disabled={!canEdit}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz === 'Asia/Jerusalem' ? t('profile.timezoneIsrael') : tz}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {canEdit ? (
        <div className="flex items-center gap-4">
          <Button type="submit" variant="primary" loading={update.isPending}>
            {t('profile.save')}
          </Button>
          {status ? (
            <p
              role="status"
              className={`flex items-center gap-1.5 text-sm font-medium ${
                status.ok ? 'text-primary' : 'text-danger'
              }`}
            >
              {status.ok ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4" aria-hidden="true" />
              )}
              {status.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={vatOpen}
        title={t('profile.vatDialogTitle')}
        body={
          <div className="space-y-3">
            <p>{t('profile.vatDialogBody')}</p>
            <Field label={t('profile.vat')} htmlFor="prof-vat" hint={vatDraftValid ? undefined : t('matching.percentRange')}>
              <Input
                id="prof-vat"
                type="text"
                inputMode="decimal"
                value={vatDraft}
                onChange={(e) => setVatDraft(e.target.value)}
                aria-invalid={!vatDraftValid || undefined}
                className="text-right"
              />
            </Field>
          </div>
        }
        confirmLabel={t('profile.vatConfirm')}
        cancelLabel={t('matching.discard')}
        danger={false}
        loading={updateVat.isPending}
        onConfirm={() => {
          if (!vatDraftValid) return;
          updateVat.mutate({ vatRate: vatDraftNum / 100 });
        }}
        onClose={() => setVatOpen(false)}
      />
    </form>
  );
}
