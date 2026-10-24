import { Mail } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/lib/components';
import { auth as authMessages } from '@/lib/i18n/messages/auth';
import { getT } from '@/lib/i18n/server';

export default async function CheckEmailPage() {
  const t = await getT(authMessages);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card elevated flow padding="lg" className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
          <Mail className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mb-2 text-2xl font-bold text-ink">{t('checkEmail.title')}</h1>
        <p className="text-sm text-muted">{t('checkEmail.body')}</p>
        {process.env.NODE_ENV !== 'production' ? (
          <p className="mt-6 text-xs text-subtle">
            {t('checkEmail.devHint')}{' '}
            <code className="font-mono text-primary">──── MAGIC LINK ────</code>.
          </p>
        ) : null}
        <p className="mt-6 text-xs">
          <Link href="/login" className="text-primary hover:underline">
            {t('checkEmail.back')}
          </Link>
        </p>
      </Card>
    </main>
  );
}
