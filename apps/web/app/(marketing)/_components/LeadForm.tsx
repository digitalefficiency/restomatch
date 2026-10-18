'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { Button, Field, Input } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { marketing } from '@/lib/i18n/messages/marketing';

/**
 * Lead-capture form for the marketing landing. Calls leads.create (public).
 * Includes a hidden honeypot field named `hp` — bots that fill it get a silent
 * { ok: true } with no insert (handled server-side); humans leave it empty.
 * Money is captured in shekels and converted to agorot for the contract.
 */
export function LeadForm() {
  const t = useT(marketing);
  // The exact opt-in wording shown to the visitor (in their language) — persisted
  // server-side as evidence of an informed marketing consent (E.7, Communications
  // Law §30A).
  const MARKETING_CONSENT_TEXT = t('lead.consentText');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [monthlyIls, setMonthlyIls] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = trpc.leads.create.useMutation({
    onSuccess: () => {
      setError(null);
    },
    onError: (err) => {
      // Server messages are Hebrew-only and technical; show a translated one.
      const code = err.data?.code;
      const status = err.data?.httpStatus ?? (err.shape as { data?: { httpStatus?: number } } | undefined)?.data?.httpStatus;
      if (code === 'TOO_MANY_REQUESTS' || status === 429) setError(t('lead.errorRate'));
      else setError(t('lead.errorGeneric'));
    },
  });

  if (create.isSuccess) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-2xl border border-primary/25 bg-primary/8 px-6 py-10 text-center shadow-glow-primary"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h3 className="text-lg font-bold text-ink">{t('lead.successTitle')}</h3>
        <p className="max-w-sm text-sm text-muted">{t('lead.successBody')}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!name.trim()) {
          setError(t('lead.errorName'));
          document.getElementById('lead-name')?.focus();
          return;
        }
        const ils = Number(monthlyIls.replace(/[^\d.]/g, ''));
        const monthlyProcurementAgorot =
          Number.isFinite(ils) && ils > 0 ? Math.round(ils * 100) : undefined;
        create.mutate({
          name: name.trim(),
          phone: phone.trim() || undefined,
          restaurantName: restaurantName.trim() || undefined,
          monthlyProcurementAgorot,
          source: 'landing',
          marketingConsent,
          consentText: marketingConsent ? MARKETING_CONSENT_TEXT : undefined,
          hp: hp.trim() || undefined,
        });
      }}
      className="space-y-4"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          htmlFor="lead-name"
          label={
            <>
              {t('lead.name')}{' '}
              <span className="text-danger" aria-hidden="true">
                *
              </span>
              <span className="sr-only">({t('lead.required')})</span>
            </>
          }
        >
          <Input
            className="h-12"
            id="lead-name"
            required
            minLength={1}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('lead.namePlaceholder')}
            autoComplete="name"
          />
        </Field>

        <Field htmlFor="lead-phone" label={t('lead.phone')}>
          <Input
            className="h-12"
            id="lead-phone"
            type="tel"
            inputMode="tel"
            maxLength={32}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('lead.phonePlaceholder')}
            autoComplete="tel"
          />
        </Field>

        <Field htmlFor="lead-restaurant" label={t('lead.restaurant')}>
          <Input
            className="h-12"
            id="lead-restaurant"
            maxLength={200}
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
            placeholder={t('lead.restaurantPlaceholder')}
            autoComplete="organization"
          />
        </Field>

        <Field
          htmlFor="lead-procurement"
          label={t('lead.procurement')}
          hint={t('lead.procurementHint')}
        >
          <Input
            className="h-12"
            id="lead-procurement"
            inputMode="numeric"
            value={monthlyIls}
            onChange={(e) => setMonthlyIls(e.target.value)}
            placeholder={t('lead.procurementPlaceholder')}
          />
        </Field>
      </div>

      {/* Honeypot — visually + a11y hidden. Bots fill it; humans never see it. */}
      <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden">
        <label htmlFor="lead-hp">{t('lead.honeypot')}</label>
        <input
          id="lead-hp"
          type="text"
          name="hp"
          tabIndex={-1}
          autoComplete="off"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      {/* Explicit, unchecked-by-default marketing opt-in (E.7). */}
      <label htmlFor="lead-marketing-consent" className="flex items-start gap-2.5 text-sm text-muted">
        <input
          id="lead-marketing-consent"
          type="checkbox"
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-primary"
        />
        <span>{MARKETING_CONSENT_TEXT}</span>
      </label>

      <Button type="submit" className="w-full" loading={create.isPending}>
        {t('lead.submit')}
      </Button>
      <p className="text-center text-xs text-subtle">
        {t('lead.privacyNoteA')}{' '}
        <Link href="/privacy" className="underline hover:text-muted">
          {t('lead.privacyLink')}
        </Link>
        .
      </p>
    </form>
  );
}
