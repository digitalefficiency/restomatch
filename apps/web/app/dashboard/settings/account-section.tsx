'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CheckCircle2, KeyRound, Languages, LogOut, XCircle } from 'lucide-react';
import { logOutEverywhereAction } from '@/app/(auth)/actions';
import { Button, Card } from '@/lib/components';
import { dirOf, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SEC, type Locale } from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/client';
import { settings } from '@/lib/i18n/messages/settings';
import { localizeServerError } from '@/lib/serverErrors';
import { trpc } from '@/lib/trpc/client';

/** Write the device language cookie + flip <html> immediately (no flash). */
function applyDeviceLocale(target: Locale) {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SEC}; samesite=lax${secure}`;
  document.documentElement.lang = target;
  document.documentElement.dir = dirOf(target);
}

/**
 * "My account" — available to EVERY role: the member's own app language (saved
 * on their membership so it follows them to new devices), the password entry
 * point (set / change) and "sign out of all devices".
 */
export function AccountSection({ hasPassword }: { hasPassword: boolean }) {
  const t = useT(settings);
  const locale = useLocale();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const setMyLocale = trpc.settings.setMyLocale.useMutation({
    onSuccess: (res) => {
      if (res.locale) applyDeviceLocale(res.locale);
      setStatus({ ok: true, message: '' });
      startRefresh(() => router.refresh());
    },
    onError: (err) =>
      setStatus({ ok: false, message: localizeServerError(err, locale, t('account.languageFailed')) }),
  });

  const options: Array<[Locale, string]> = [
    ['he', t('account.he')],
    ['en', t('account.en')],
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card flow elevated padding="lg">
        <div className="mb-1 flex items-center gap-2">
          <Languages className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-base font-semibold text-ink">{t('account.languageTitle')}</h3>
        </div>
        <p className="mb-4 text-sm text-muted">{t('account.languageHint')}</p>
        <div role="radiogroup" aria-label={t('account.languageTitle')} className="flex gap-2">
          {options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={locale === value}
              lang={value}
              disabled={setMyLocale.isPending || refreshing}
              onClick={() => {
                setStatus(null);
                setMyLocale.mutate({ locale: value });
              }}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                locale === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-line bg-surface-2 text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {status ? (
          <p
            role="status"
            className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${status.ok ? 'text-primary' : 'text-danger'}`}
          >
            {status.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {status.ok ? t('account.languageSaved') : status.message}
          </p>
        ) : null}
      </Card>

      <Card flow elevated padding="lg">
        <div className="mb-1 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-base font-semibold text-ink">{t('account.passwordTitle')}</h3>
        </div>
        <p className="mb-4 text-sm text-muted">
          {hasPassword ? t('account.passwordSet') : t('account.passwordNone')}
        </p>
        <Link
          href="/set-password"
          className="inline-flex items-center rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-primary/40 hover:text-primary"
        >
          {hasPassword ? t('account.passwordChangeCta') : t('account.passwordSetCta')}
        </Link>
      </Card>

      <Card flow elevated padding="lg">
        <div className="mb-1 flex items-center gap-2">
          <LogOut className="h-4 w-4 text-primary" aria-hidden="true" />
          <h3 className="text-base font-semibold text-ink">{t('account.devicesTitle')}</h3>
        </div>
        <p className="mb-4 text-sm text-muted">{t('account.devicesHint')}</p>
        <form
          action={logOutEverywhereAction}
          onSubmit={(e) => {
            if (!window.confirm(t('account.devicesConfirm'))) e.preventDefault();
          }}
        >
          <Button type="submit" variant="secondary">
            {t('account.devicesCta')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
