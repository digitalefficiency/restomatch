'use client';

import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button, Input } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { onboarding } from '@/lib/i18n/messages/onboarding';
import { localizeServerError } from '@/lib/serverErrors';
import { startRouteProgress } from '@/lib/components/routeProgressState';
import { saveSignerNameAction } from './actions';
import { firstInvalid, validateOnboarding, type OnboardingField } from './logic';

const ERROR_KEY = { yourName: 'errors.yourName', name: 'errors.name', businessId: 'errors.businessId' } as const;

/**
 * Restaurant + signer name (auth-27). `noValidate`: the browser's native bubble
 * (in the browser's language) never pre-empts our inline, translated errors;
 * each invalid field gets `aria-invalid` + its message via `aria-describedby`,
 * and focus moves to the first one (auth-21). Success continues to `next` —
 * the validated callbackUrl (auth-09) — through the session refresh.
 */
export function OnboardingForm({ next, initialName }: { next: string; initialName: string }) {
  const t = useT(onboarding);
  const locale = useLocale();
  const [values, setValues] = useState({ yourName: initialName, name: '', businessId: '' });
  const [errors, setErrors] = useState<Partial<Record<OnboardingField, true>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const refs = {
    yourName: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    businessId: useRef<HTMLInputElement>(null),
  };

  const create = trpc.onboarding.createRestaurant.useMutation({
    onSuccess: () => {
      const target = `/api/session/refresh?next=${encodeURIComponent(next)}`;
      startRouteProgress(next);
      // A full navigation: the refresh handler re-issues the session cookie with
      // the new membership before the destination renders.
      window.location.assign(target);
    },
    onError: (err) => {
      setServerError(localizeServerError(err, locale));
    },
  });

  const set = (field: OnboardingField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setValues((v) => ({ ...v, [field]: value }));
    // Fix-as-you-type: an error clears as soon as the field is valid again.
    if (errors[field]) {
      const again = validateOnboarding({ ...values, [field]: value }).errors;
      if (!again[field]) setErrors((x) => ({ ...x, [field]: undefined }));
    }
  };

  const fieldProps = (field: OnboardingField, hintId?: string) => ({
    id: field,
    ref: refs[field],
    value: values[field],
    onChange: set(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': [hintId, errors[field] ? `${field}-error` : ''].filter(Boolean).join(' ') || undefined,
    className: 'min-h-11 text-base',
  });

  const errorLine = (field: OnboardingField) =>
    errors[field] ? (
      <p id={`${field}-error`} className="mt-1.5 text-sm font-medium text-danger">
        {t(ERROR_KEY[field])}
      </p>
    ) : null;

  const busy = savingName || create.isPending;

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setServerError(null);
        const v = validateOnboarding(values);
        setErrors(v.errors);
        const first = firstInvalid(v.errors);
        if (first) {
          refs[first].current?.focus();
          return;
        }
        if (v.values.businessId !== values.businessId) setValues((x) => ({ ...x, businessId: v.values.businessId ?? '' }));
        setSavingName(true);
        // Best effort: the restaurant is what matters; a failed name save never blocks it.
        await saveSignerNameAction(v.values.yourName).catch(() => null);
        setSavingName(false);
        create.mutate({ name: v.values.name, businessId: v.values.businessId });
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="yourName" className="mb-1 block text-sm font-medium text-muted">
          {t('yourName')} <span className="text-muted">{t('required')}</span>
        </label>
        <p id="yourName-hint" className="mb-1.5 text-sm text-muted">
          {t('yourNameHint')}
        </p>
        <Input {...fieldProps('yourName', 'yourName-hint')} autoComplete="name" maxLength={80} placeholder={t('yourNamePlaceholder')} />
        {errorLine('yourName')}
      </div>

      <div>
        <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-muted">
          {t('name')} <span className="text-muted">{t('required')}</span>
        </label>
        <Input {...fieldProps('name')} autoComplete="organization" maxLength={120} placeholder={t('namePlaceholder')} />
        {errorLine('name')}
      </div>

      <div>
        <label htmlFor="businessId" className="mb-1 block text-sm font-medium text-muted">
          {t('businessId')} <span className="text-muted">{t('optional')}</span>
        </label>
        <p id="businessId-hint" className="mb-1.5 text-sm text-muted">
          {t('businessIdHint')}
        </p>
        <Input
          {...fieldProps('businessId', 'businessId-hint')}
          inputMode="numeric"
          dir="ltr"
          maxLength={20}
          placeholder="514778123"
          className="min-h-11 text-base rtl:text-right"
        />
        {errorLine('businessId')}
      </div>

      {serverError ? (
        <div role="alert" className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger">
          {serverError}
        </div>
      ) : null}

      <Button type="submit" data-keep-clear className="min-h-12 w-full text-base" loading={busy}>
        {t('submit')}
      </Button>
    </form>
  );
}
