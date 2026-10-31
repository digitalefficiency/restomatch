import Link from 'next/link';
import { admin } from '@/lib/i18n/messages/admin';
import { getT } from '@/lib/i18n/server';

/** adminProcedure's refusal for a login with no authenticator enrolled (packages/api trpc.ts). */
const ADMIN_REQUIRES_2FA = 'admin_requires_2fa';

export function isAdmin2faRequired(err: unknown): boolean {
  return err instanceof Error && err.message === ADMIN_REQUIRES_2FA;
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
