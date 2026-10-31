import Link from 'next/link';
import { admin } from '@/lib/i18n/messages/admin';
import { getT } from '@/lib/i18n/server';

/**
 * adminProcedure's refusal for a login with no authenticator enrolled: appCode
 * admin_requires_2fa — `error.data.appCode` over HTTP, `error.cause.appCode` on
 * the server-side caller these pages use.
 */
export function isAdmin2faRequired(err: unknown): boolean {
  const e = err as { data?: { appCode?: unknown } | null; cause?: { appCode?: unknown } | null } | null;
  return (e?.data?.appCode ?? e?.cause?.appCode) === 'admin_requires_2fa';
}

/** Shown on /admin pages instead of tenant data until the admin's login has TOTP. */
export async function TwoFactorRequired() {
  const t = await getT(admin);
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-line bg-surface p-6 shadow-card">
      <h1 className="mb-2 text-xl font-bold text-ink">{t('twoFactor.title')}</h1>
      <p className="mb-4 text-sm text-muted">{t('twoFactor.body')}</p>
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:brightness-90"
      >
        {t('twoFactor.cta')}
      </Link>
    </section>
  );
}
