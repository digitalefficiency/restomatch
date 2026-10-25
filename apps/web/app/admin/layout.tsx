import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { admin } from '@/lib/i18n/messages/admin';
import { nav } from '@/lib/i18n/messages/nav';
import { getT } from '@/lib/i18n/server';
import { TrpcProvider } from '@/lib/trpc/client';

/**
 * Platform-admin console gate. Non-admins get a 404 (the section's existence is
 * not advertised). Auth + admin are checked here AND in every adminProcedure.
 * Direction follows the root layout's <html dir> (Hebrew RTL / English LTR).
 * Landmarks (ia-nav-24): skip link → banner with a labelled nav → main.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/admin');
  if (session.user.twoFactorPending) redirect('/login/2fa?callbackUrl=/admin');
  if (!(await isPlatformAdmin(session.user.id))) notFound();
  const [t, tn] = await Promise.all([getT(admin), getT(nav)]);
  const link =
    'rounded transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60';

  return (
    <TrpcProvider>
      <div className="min-h-screen bg-bg">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-on-primary"
        >
          {tn('skipToContent')}
        </a>
        <header className="sticky top-0 z-30 border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-primary px-2 py-1 text-xs font-bold text-on-primary">{t('layout.badge')}</span>
              <span className="text-sm text-muted">{t('layout.title')}</span>
            </div>
            <nav aria-label={tn('shell.platformAdmin')} className="flex items-center gap-4 text-sm font-medium text-muted">
              <Link href="/admin" className={link}>
                {t('layout.restaurants')}
              </Link>
              <Link href="/admin/leads" className={link}>
                {t('layout.leads')}
              </Link>
              <Link href="/dashboard" className={`${link} text-subtle`}>
                {t('layout.backToDashboard')}
              </Link>
              <LocaleSwitcher />
            </nav>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-6 py-8 focus:outline-none">
          {children}
        </main>
      </div>
    </TrpcProvider>
  );
}
