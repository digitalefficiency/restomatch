import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/admin';
import { LocaleSwitcher } from '@/lib/i18n/LocaleSwitcher';
import { admin } from '@/lib/i18n/messages/admin';
import { getT } from '@/lib/i18n/server';
import { TrpcProvider } from '@/lib/trpc/client';

/**
 * Platform-admin console gate. Non-admins get a 404 (the section's existence is
 * not advertised). Auth + admin are checked here AND in every adminProcedure.
 * Direction follows the root layout's <html dir> (Hebrew RTL / English LTR).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login?callbackUrl=/admin');
  if (session.user.twoFactorPending) redirect('/login/2fa?callbackUrl=/admin');
  if (!(await isPlatformAdmin(session.user.id))) notFound();
  const t = await getT(admin);

  return (
    <TrpcProvider>
      <main className="min-h-screen bg-bg">
        <header className="glass sticky top-0 z-30 border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-primary px-2 py-1 font-mono text-xs font-bold text-on-primary">
                {t('layout.badge')}
              </span>
              <span className="text-sm text-muted">{t('layout.title')}</span>
            </div>
            <nav className="flex items-center gap-4 text-sm font-medium text-muted">
              <Link href="/admin" className="transition-colors hover:text-ink">
                {t('layout.restaurants')}
              </Link>
              <Link href="/admin/leads" className="transition-colors hover:text-ink">
                {t('layout.leads')}
              </Link>
              <Link href="/dashboard" className="text-subtle transition-colors hover:text-ink">
                {t('layout.backToDashboard')}
              </Link>
              <LocaleSwitcher />
            </nav>
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </TrpcProvider>
  );
}
