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

type Status = 'done' | 'failed' | 'notOwner' | 'disabled';
const STATUSES: readonly Status[] = ['done', 'failed', 'notOwner', 'disabled'];

const claimPath = (token: string) => `/leak-check/claim?t=${encodeURIComponent(token)}`;

/**
 * "Start a trial with these results". A GET never changes anything (a link
 * planted on another site must not attach someone's results to a victim's
 * restaurant): the signed-in OWNER confirms with a POST (server action, CSRF-
 * protected by Next), and the claim also requires the account email to match
 * the email the check was run with.
 */
export default async function LeakCheckClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; status?: string }>;
}) {
  if (!lc.leakCheckPublicEnabled()) notFound();
  const { t: token = '', status } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect(`/login?callbackUrl=${encodeURIComponent(claimPath(token))}`);
  if (!session.user.restaurantId) redirect(`/onboarding?callbackUrl=${encodeURIComponent(claimPath(token))}`);

  async function confirmClaim(formData: FormData) {
    'use server';
    const tk = String(formData.get('token') ?? '').slice(0, 200);
    let result: Status = 'done';
    try {
      const caller = await createServerCaller();
      await caller.leakCheck.claim({ token: tk });
    } catch (err) {
      const e = err as { code?: string; cause?: { appCode?: string } };
      result =
        e.cause?.appCode === 'FEATURE_DISABLED' ? 'disabled' : e.code === 'FORBIDDEN' ? 'notOwner' : 'failed';
    }
    redirect(`${claimPath(tk)}&status=${result}`);
  }

  const t = await getT(leakCheck);
  const shown = STATUSES.includes(status as Status) ? (status as Status) : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-extrabold text-ink">{t('claim.title')}</h1>
      {shown ? (
        <>
          <p role={shown === 'done' ? 'status' : 'alert'} className={'mt-4 text-base ' + (shown === 'done' ? 'text-primary' : 'text-muted')}>
            {t(`claim.${shown}`)}
          </p>
          <Link
            href="/dashboard"
            className="mt-8 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-glow-primary hover:brightness-110"
          >
            {t('claim.toDashboard')}
          </Link>
        </>
      ) : (
        <form action={confirmClaim} className="mt-6">
          <p className="text-base text-muted">{t('claim.confirm')}</p>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            data-testid="claim-confirm"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-glow-primary hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('claim.confirmButton')}
          </button>
        </form>
      )}
    </div>
  );
}
