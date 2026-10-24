import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, SearchCheck } from 'lucide-react';
import { leakCheck as lc } from '@restomatch/api';
import { getT } from '@/lib/i18n/server';
import { leakCheck } from '@/lib/i18n/messages/leakCheck';
import { alternatesFor, metadataBase } from '../_components/seo';
import { LeakCheckForm } from './LeakCheckForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(leakCheck);
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    metadataBase,
    alternates: alternatesFor('/leak-check', t.locale),
    openGraph: { title: t('meta.title'), description: t('meta.description'), url: '/leak-check' },
  };
}

/**
 * Free leak check — public lead magnet (S15 wave 1). Exists only with
 * LEAK_CHECK_PUBLIC=1 and the `leakCheck` kill-switch off; 404 otherwise.
 */
export default async function LeakCheckPage() {
  if (!lc.leakCheckPublicEnabled()) notFound();
  const t = await getT(leakCheck);
  const available = lc.leakCheckOcrMode() !== null;
  const checks = ['duplicate', 'vat', 'arithmetic', 'creep', 'priceList'] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase text-gold ltr:font-mono ltr:tracking-[0.2em] rtl:text-sm">
            {t('page.eyebrow')}
          </p>
          <h1 className="text-balance text-3xl font-extrabold tracking-tight text-ink sm:text-5xl">{t('page.title')}</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">{t('page.lead')}</p>
          <ul className="mt-6 space-y-2.5">
            {(['one', 'two', 'three'] as const).map((k) => (
              <li key={k} className="flex items-start gap-2 text-sm text-ink">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {t(`page.points.${k}`)}
              </li>
            ))}
          </ul>

          <div className="mt-10 rounded-2xl border border-line bg-surface p-6 shadow-card">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink">
              <SearchCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              {t('page.checksTitle')}
            </h2>
            <ul className="mt-4 space-y-2 text-sm text-muted">
              {checks.map((k) => (
                <li key={k} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {t(`page.checks.${k}`)}
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-subtle">{t('page.checksNote')}</p>
          </div>
        </div>

        {available ? (
          <LeakCheckForm />
        ) : (
          <div className="rounded-3xl border border-line bg-surface p-8 text-center shadow-card">
            <p className="text-base text-muted">{t('page.unavailable')}</p>
            <Link
              href="/#lead"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-glow-primary hover:brightness-110"
            >
              {t('page.unavailableCta')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
