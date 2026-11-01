'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckCircle2, MessageCircle, PlayCircle } from 'lucide-react';
import { TrpcProvider, trpc } from '@/lib/trpc/client';
import { Button, Input } from '@/lib/components';
import { useT } from '@/lib/i18n/client';
import { marketing } from '@/lib/i18n/messages/marketing';
import { contactChannels, whatsappHref } from '@/lib/contact';
import { readAttribution } from './Attribution';
import {
  buildLeadSource,
  firstInvalidField,
  formatIlPhone,
  validateLead,
  type LeadFieldErrors,
} from './leadForm.logic';

/**
 * Lead-capture form for the marketing site. Calls leads.create (public).
 * Includes a hidden honeypot field named `hp` — bots that fill it get a silent
 * { ok: true } with no insert (handled server-side); humans leave it empty.
 * Money is captured in shekels and converted to agorot for the contract.
 *
 * W1-12: the name stays required (router contract unchanged); the client also
 * requires a way back — a valid Israeli phone OR an e-mail (mkt-01). Errors sit
 * under their field and are tied to it with aria-describedby (mkt-09). The
 * success state says who gets back to whom and how, with a next step (mkt-07).
 * `source` carries the page, the placement, the plan and the UTM campaign (mkt-28).
 */
/** Self-provided: the lead form loads lazily on public pages, which don't ship tRPC up front. */
export function LeadForm({ cta = 'lead' }: { cta?: string }) {
  return (
    <TrpcProvider>
      <LeadFormInner cta={cta} />
    </TrpcProvider>
  );
}

const FIELD_IDS = { name: 'lead-name', phone: 'lead-phone', email: 'lead-email' } as const;

function LeadFormInner({ cta }: { cta: string }) {
  const t = useT(marketing);
  const pathname = usePathname();
  // The exact opt-in wording shown to the visitor (in their language) — persisted
  // server-side as evidence of an informed marketing consent (E.7, Communications
  // Law §30A).
  const MARKETING_CONSENT_TEXT = t('lead.consentText');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [monthlyIls, setMonthlyIls] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [hp, setHp] = useState('');
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ name: string; phone: string; email: string } | null>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const channels = contactChannels();

  const create = trpc.leads.create.useMutation({
    onSuccess: () => {
      setSubmitError(null);
    },
    onError: (err) => {
      // Server messages are Hebrew-only and technical; show a translated one.
      const code = err.data?.code;
      // The route's rate limiter answers 429 before tRPC runs, with a plain JSON
      // body — no tRPC error shape, so only the raw response carries the status.
      const status =
        err.data?.httpStatus ??
        (err.shape as { data?: { httpStatus?: number } } | undefined)?.data?.httpStatus ??
        (err as { meta?: { response?: { status?: number } } }).meta?.response?.status;
      if (code === 'TOO_MANY_REQUESTS' || status === 429) setSubmitError(t('lead.errorRate'));
      else setSubmitError(t('lead.errorGeneric'));
    },
  });

  // The submit button unmounts on success — move focus to the confirmation so
  // keyboard / screen-reader users aren't dropped at the top of the page.
  useEffect(() => {
    if (create.isSuccess) successRef.current?.focus();
  }, [create.isSuccess]);

  if (create.isSuccess && sent) {
    const wa = channels.whatsapp
      ? whatsappHref(channels.whatsapp.digits, t('lead.successWhatsappText', { name: sent.name }))
      : null;
    return (
      <div
        role="status"
        data-testid="lead-success"
        className="flex flex-col items-center gap-4 rounded-2xl border border-primary/25 bg-primary/8 px-6 py-8 text-center"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </span>
        <h3
          ref={successRef}
          tabIndex={-1}
          className="text-lg font-bold text-ink focus:outline-none"
        >
          {t('lead.successTitle', { name: sent.name })}
        </h3>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          {sent.phone
            ? t('lead.successBodyPhone', { phone: '⁨' + sent.phone + '⁩' })
            : t('lead.successBodyEmail', { email: '⁨' + sent.email + '⁩' })}
        </p>
        <div className="flex w-full max-w-sm flex-col gap-2">
          {wa ? (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {t('lead.successWhatsapp')}
            </a>
          ) : null}
          <Link
            href="/showcase"
            className={
              wa
                ? 'flex min-h-12 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                : 'flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-on-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
            }
          >
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            {t('lead.successDemo')}
          </Link>
        </div>
      </div>
    );
  }

  const errorId = (f: keyof typeof FIELD_IDS) => `${FIELD_IDS[f]}-error`;
  const phoneError = errors.phone ?? errors.contact;
  const describedBy = (...ids: Array<string | false | undefined>) =>
    ids.filter(Boolean).join(' ') || undefined;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitError(null);
        const found = validateLead({ name, phone, email });
        setErrors(found);
        const first = firstInvalidField(found);
        if (first) {
          const el = document.getElementById(FIELD_IDS[first]);
          // Centre it so the sticky header never covers the field or its error.
          el?.scrollIntoView({ block: 'center' });
          el?.focus({ preventScroll: true });
          return;
        }
        const ils = Number(monthlyIls.replace(/[^\d.]/g, ''));
        const monthlyProcurementAgorot =
          Number.isFinite(ils) && ils > 0 ? Math.round(ils * 100) : undefined;
        const cleanPhone = phone.trim() ? formatIlPhone(phone) : '';
        const cleanEmail = email.trim();
        setSent({ name: name.trim(), phone: cleanPhone, email: cleanEmail });
        create.mutate({
          name: name.trim(),
          phone: cleanPhone || undefined,
          email: cleanEmail || undefined,
          restaurantName: restaurantName.trim() || undefined,
          monthlyProcurementAgorot,
          source: buildLeadSource(pathname, cta, readAttribution()),
          marketingConsent,
          consentText: marketingConsent ? MARKETING_CONSENT_TEXT : undefined,
          hp: hp.trim() || undefined,
        });
      }}
      className="space-y-4"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LeadField
          id={FIELD_IDS.name}
          label={
            <>
              {t('lead.name')}{' '}
              <span className="text-danger" aria-hidden="true">
                *
              </span>
              <span className="sr-only">({t('lead.required')})</span>
            </>
          }
          error={errors.name ? t(`lead.${errors.name}`) : null}
        >
          <Input
            className="h-12 text-base"
            id={FIELD_IDS.name}
            required
            minLength={1}
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('lead.namePlaceholder')}
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy(errors.name && errorId('name'))}
          />
        </LeadField>

        <LeadField id="lead-restaurant" label={t('lead.restaurant')} error={null}>
          <Input
            className="h-12 text-base"
            id="lead-restaurant"
            maxLength={200}
            value={restaurantName}
            onChange={(e) => setRestaurantName(e.target.value)}
            placeholder={t('lead.restaurantPlaceholder')}
            autoComplete="organization"
          />
        </LeadField>
      </div>

      <fieldset className="space-y-3 rounded-2xl border border-line p-4">
        <legend className="px-1 text-sm font-medium text-ink">
          {t('lead.contactHint')}{' '}
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LeadField
            id={FIELD_IDS.phone}
            label={t('lead.phone')}
            error={phoneError ? t(`lead.${phoneError}`) : null}
          >
            <Input
              className="h-12 text-base rtl:text-right"
              id={FIELD_IDS.phone}
              type="tel"
              inputMode="tel"
              dir="ltr"
              maxLength={32}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('lead.phonePlaceholder')}
              autoComplete="tel"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={describedBy(phoneError && errorId('phone'))}
            />
          </LeadField>
          <LeadField
            id={FIELD_IDS.email}
            label={t('lead.email')}
            error={errors.email ? t(`lead.${errors.email}`) : null}
          >
            <Input
              className="h-12 text-base rtl:text-right"
              id={FIELD_IDS.email}
              type="email"
              inputMode="email"
              dir="ltr"
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('lead.emailPlaceholder')}
              autoComplete="email"
              aria-invalid={errors.email || errors.contact ? true : undefined}
              aria-describedby={describedBy(
                errors.email ? errorId('email') : errors.contact && errorId('phone'),
              )}
            />
          </LeadField>
        </div>
      </fieldset>

      <LeadField
        id="lead-procurement"
        label={t('lead.procurement')}
        hint={t('lead.procurementHint')}
        error={null}
      >
        <Input
          className="h-12 text-base"
          id="lead-procurement"
          inputMode="numeric"
          value={monthlyIls}
          onChange={(e) => setMonthlyIls(e.target.value)}
          placeholder={t('lead.procurementPlaceholder')}
          aria-describedby="lead-procurement-hint"
        />
      </LeadField>

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

      {/* Explicit, unchecked-by-default marketing opt-in (E.7). */}
      <label
        htmlFor="lead-marketing-consent"
        className="flex items-start gap-2.5 text-sm text-muted"
      >
        <input
          id="lead-marketing-consent"
          type="checkbox"
          checked={marketingConsent}
          onChange={(e) => setMarketingConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-primary"
        />
        <span>{MARKETING_CONSENT_TEXT}</span>
      </label>

      {submitError ? (
        <div
          id="lead-error"
          role="alert"
          className="rounded-md border-s-4 border-danger bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {submitError}
          {channels.whatsapp ? (
            <>
              {' '}
              <a
                href={whatsappHref(channels.whatsapp.digits, t('shell.whatsappText'))}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
              >
                {t('lead.errorWhatsapp')}
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" className="h-12 w-full text-base" loading={create.isPending}>
        {t('lead.submit')}
      </Button>
      <p className="text-center text-xs text-muted">
        {t('lead.privacyNoteA')}{' '}
        <Link href="/privacy" className="underline hover:text-ink">
          {t('lead.privacyLink')}
        </Link>
        .
      </p>
    </form>
  );
}

/** Label → (hint) → control → error, the error tied to the control by id (`<id>-error`). */
function LeadField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: React.ReactNode;
  hint?: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-muted">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="-mt-1 mb-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
