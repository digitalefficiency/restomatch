import { notFound } from 'next/navigation';
import { count, eq, authenticators } from '@restomatch/db';
import { requireFullSession } from '@/lib/authGuards';
import { authDb } from '@/lib/authDb';
import { LinkButton } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';
import { passkeyAllowedFor, passkeysEnabled } from '../_lib/passkeys';
import { AuthShell, authTitle } from '../_components/AuthShell';
import { PasskeyButton } from '../_components/PasskeyButton';

export const dynamic = 'force-dynamic';
export const generateMetadata = () => authTitle('passkeys.title');

/** W3-07b: add a passkey to this account (owner / bookkeeper, flag PASSKEYS_ENABLED). */
export default async function PasskeysPage() {
  if (!passkeysEnabled()) notFound();
  const { userId } = await requireFullSession();
  const [t, allowed, [row]] = await Promise.all([
    getT(authMessages),
    passkeyAllowedFor(userId),
    authDb.select({ c: count() }).from(authenticators).where(eq(authenticators.userId, userId)),
  ]);
  const have = Number(row?.c ?? 0);

  return (
    <AuthShell>
      <h1 className="mb-2 text-2xl font-bold text-ink">{t('passkeys.title')}</h1>
      <p className="mb-6 text-base text-ink">{allowed ? t('passkeys.intro') : t('passkeys.notForRole')}</p>
      {allowed ? (
        <>
          <p className="mb-4 text-sm text-muted" data-testid="passkey-count">
            {t('passkeys.count', { count: have })}
          </p>
          <PasskeyButton
            mode="register"
            label={t('passkeys.add')}
            failedLabel={t('passkeys.failed')}
            callbackUrl="/passkeys"
          />
        </>
      ) : null}
      <LinkButton href="/dashboard" variant="tertiary" className="mt-6 min-h-11 w-full">
        {t('passkeys.back')}
      </LinkButton>
    </AuthShell>
  );
}
