'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CheckCircle2, KeyRound, LogOut, XCircle } from 'lucide-react';
import { logOutEverywhereAction } from '@/app/(auth)/actions';
import { Button } from '@/lib/components';
import { SettingRow, SettingsRows } from './_components/ui';
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
 * "חשבון" — available to EVERY role: the member's own app language (saved
 * on their membership so it follows them to new devices), the password entry
 * point (set / change) and "sign out of all devices". DS3-06: one row each.
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
    <div className="space-y-2">
      <SettingsRows>
        <SettingRow
          id="language"
          label={t('account.languageTitle')}
          hint={t('account.languageHint')}
          control={
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
                  className={`min-h-9 rounded-control px-4 text-body-sm font-semibold ring-1 ring-inset transition-colors duration-micro disabled:opacity-60 [@media(pointer:coarse)]:min-h-11 ${
                    locale === value ? 'bg-primary/10 text-primary ring-primary' : 'bg-surface text-muted ring-line-strong hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          id="password"
          label={t('account.passwordTitle')}
          hint={hasPassword ? t('account.passwordSet') : t('account.passwordNone')}
          control={
            <Link
              href="/set-password"
              className="inline-flex min-h-9 items-center rounded-control bg-surface px-4 text-body-sm font-semibold text-ink ring-1 ring-inset ring-line-strong transition-colors duration-micro hover:text-primary [@media(pointer:coarse)]:min-h-11"
            >
              <KeyRound className="me-1.5 h-4 w-4" aria-hidden="true" />
              {hasPassword ? t('account.passwordChangeCta') : t('account.passwordSetCta')}
            </Link>
          }
        />
        <SettingRow
          id="devices"
          label={t('account.devicesTitle')}
          hint={t('account.devicesHint')}
          control={
            <form
              action={logOutEverywhereAction}
              onSubmit={(e) => {
                if (!window.confirm(t('account.devicesConfirm'))) e.preventDefault();
              }}
            >
              <Button type="submit" variant="secondary" size="sm">
                <LogOut className="me-1.5 h-4 w-4" aria-hidden="true" />
                {t('account.devicesCta')}
              </Button>
            </form>
          }
        />
      </SettingsRows>
      {status ? (
        <p
          role="status"
          className={`flex items-center gap-1.5 text-caption font-medium ${status.ok ? 'text-primary' : 'text-danger'}`}
        >
          {status.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {status.ok ? t('account.languageSaved') : status.message}
        </p>
      ) : null}
    </div>
  );
}
