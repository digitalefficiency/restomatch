import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { leakCheck as lc } from '@restomatch/api';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { getT } from '@/lib/i18n/server';
import { leakCheck } from '@/lib/i18n/messages/leakCheck';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * "Start a trial with these results": a signed-out prospect goes through
 * /login (sign-up / magic link) and comes back here; a signed-in OWNER attaches
 * the sandbox session to their restaurant via leakCheck.claim (flag-gated, RLS
 * for the tenant check, signed link for the sandbox row).
 */
export default async function LeakCheckClaimPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (!lc.leakCheckPublicEnabled()) notFound();
  const { t: token = '' } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/leak-check/claim?t=${encodeURIComponent(token)}`)}`);
  }
  if (!session.user.restaurantId) {
    redirect(`/onboarding?callbackUrl=${encodeURIComponent(`/leak-check/claim?t=${encodeURIComponent(token)}`)}`);
  }

  const t = await getT(leakCheck);
  let message: string;
  let ok = false;
  try {
    const caller = await createServerCaller();
    await caller.leakCheck.claim({ token });
    ok = true;
    message = t('claim.done');
  } catch (err) {
    const e = err as { code?: string; cause?: { appCode?: string } };
    message =
      e.cause?.appCode === 'FEATURE_DISABLED'
        ? t('claim.disabled')
        : e.code === 'FORBIDDEN'
          ? t('claim.notOwner')
          : t('claim.failed');
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-extrabold text-ink">{t('claim.title')}</h1>
      <p role={ok ? 'status' : 'alert'} className={'mt-4 text-base ' + (ok ? 'text-primary' : 'text-muted')}>
        {message}
      </p>
      <Link
        href="/dashboard"
        className="mt-8 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-glow-primary hover:brightness-110"
      >
        {t('claim.toDashboard')}
      </Link>
    </div>
  );
}
