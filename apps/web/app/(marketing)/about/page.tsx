import type { Metadata } from 'next';
import Link from 'next/link';
import { Target, HeartHandshake, ScanLine } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { marketing } from '@/lib/i18n/messages/marketing';
import { alternatesFor, metadataBase } from '../_components/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('about.metaTitle'),
    description: t('about.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/about'),
    openGraph: { title: t('about.metaTitle'), description: t('about.metaDescription'), url: '/about' },
  };
}

export default async function AboutPage() {
  const t = await getT(marketing);
  const values = [
    { icon: Target, title: t('about.v1Title'), body: t('about.v1Body') },
    { icon: ScanLine, title: t('about.v2Title'), body: t('about.v2Body') },
    { icon: HeartHandshake, title: t('about.v3Title'), body: t('about.v3Body') },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mb-12">
        <div className="mb-4 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{t('about.title')}</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">{t('about.p1')}</p>
        <p className="mt-4 text-lg leading-relaxed text-muted">{t('about.p2')}</p>
        <p className="mt-4 text-lg leading-relaxed text-muted">{t('about.p3')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {values.map((v) => {
          const Icon = v.icon;
          return (
            <div key={v.title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-base font-bold text-ink">{v.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{v.body}</p>
            </div>
          );
        })}
      </div>

      <div className="relative mt-14 overflow-hidden rounded-3xl border border-line bg-surface p-8 text-center shadow-card">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px flow-stream" />
        <h2 className="text-xl font-bold tracking-tight text-ink">{t('about.ctaTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t('about.ctaBody')}</p>
        <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/#lead"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-on-primary shadow-glow-primary transition-all hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t('about.cta')}
          </Link>
          <Link href="/showcase" className="text-sm font-medium text-primary hover:underline">
            {t('about.demo')}
          </Link>
        </div>
      </div>
    </div>
  );
}
