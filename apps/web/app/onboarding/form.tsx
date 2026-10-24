'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Button, Field, Input } from '@/lib/components';
import { useLocale, useT } from '@/lib/i18n/client';
import { onboarding } from '@/lib/i18n/messages/onboarding';
import { localizeServerError } from '@/lib/serverErrors';
import { startRouteProgress } from '@/lib/components/routeProgressState';

export function OnboardingForm() {
  const router = useRouter();
  const t = useT(onboarding);
  const locale = useLocale();
  const [name, setName] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.onboarding.createRestaurant.useMutation({
    onSuccess: () => {
      router.refresh();
      startRouteProgress('/dashboard');
      router.push('/dashboard');
    },
    onError: (err) => {
      setError(localizeServerError(err, locale));
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const trimmed = name.trim();
        const biz = businessId.trim();
        // Validate client-side with translated copy (the server re-validates).
        if (trimmed.length < 2 || trimmed.length > 120) return setError(t('errors.name'));
        if (biz && !/^\d{9,12}$/.test(biz)) return setError(t('errors.businessId'));
        create.mutate({ name: trimmed, businessId: biz || undefined });
      }}
      className="space-y-4"
    >
      <Field
        htmlFor="name"
        label={
          <>
            {t('name')} <span className="text-danger">*</span>
          </>
        }
      >
        <Input
          id="name"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
        />
      </Field>

      <Field
        htmlFor="businessId"
        hint={t('businessIdHint')}
        label={
          <>
            {t('businessId')} <span className="text-subtle">{t('optional')}</span>
          </>
        }
      >
        <Input
          id="businessId"
          inputMode="numeric"
          dir="ltr"
          pattern="\d{9,12}"
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          placeholder="514778123"
        />
      </Field>

      {error ? (
        <div
          role="alert"
          className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <Button type="submit" className="w-full" loading={create.isPending}>
        {t('submit')}
      </Button>
    </form>
  );
}
