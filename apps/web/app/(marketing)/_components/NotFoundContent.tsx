import Link from 'next/link';
import { Compass } from 'lucide-react';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { primaryCtaHref } from './cta';

/**
 * The honest public 404 (W1-12 · mkt-12, perf-states-09): inside the marketing
 * chrome, with the places a visitor actually wants — home, the free leak check,
 * the live demo, pricing — instead of "back to overview" → /dashboard → /login.
 * Plain styled links (no Link > Button nesting).
 */
export async function NotFoundContent() {
  const t = await getT(marketing);
  const primary =
    'inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-5 text-base font-semibold text-on-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';
  const secondary =
    'inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-5 text-base font-semibold text-ink hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  return (
    <div
      className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center sm:py-28"
      data-testid="not-found"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/25">
        <Compass className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="mt-5 text-sm font-semibold tabular-nums text-primary">{t('notFound.code')}</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-ink">
        {t('notFound.title')}
      </h1>
      <p className="mt-3 text-base text-muted">{t('notFound.body')}</p>
      <nav aria-label={t('notFound.linksLabel')} className="mt-8 w-full">
        <ul className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
          <li>
            <Link href="/" className={`${primary} w-full sm:w-auto`}>
              {t('notFound.home')}
            </Link>
          </li>
          <li>
            <Link href={primaryCtaHref()} className={`${secondary} w-full sm:w-auto`}>
              {t('shell.cta')}
            </Link>
          </li>
          <li>
            <Link href="/showcase" className={`${secondary} w-full sm:w-auto`}>
              {t('notFound.demo')}
            </Link>
          </li>
          <li>
            <Link href="/pricing" className={`${secondary} w-full sm:w-auto`}>
              {t('notFound.pricing')}
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
