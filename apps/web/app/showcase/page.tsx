import Link from 'next/link';
import {
  ArrowLeft,
  FileSearch,
  LayoutDashboard,
  PackageOpen,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { showcase } from '@/lib/i18n/messages/showcase';
import { getT } from '@/lib/i18n/server';

type CardId = 'receiver' | 'dashboard' | 'invoices' | 'deliveries' | 'approvals';

const CARDS: { id: CardId; href: string; icon: React.ReactNode }[] = [
  { id: 'receiver', href: '/showcase/receiver', icon: <PackageOpen className="w-5 h-5" /> },
  { id: 'dashboard', href: '/showcase/dashboard', icon: <LayoutDashboard className="w-5 h-5" /> },
  { id: 'invoices', href: '/showcase/dashboard/invoices', icon: <FileSearch className="w-5 h-5" /> },
  { id: 'deliveries', href: '/showcase/deliveries', icon: <Truck className="w-5 h-5" /> },
  { id: 'approvals', href: '/showcase/approvals', icon: <ShieldCheck className="w-5 h-5" /> },
];

export default async function ShowcaseIndex() {
  const t = await getT(showcase);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
      <div className="mb-12 sm:mb-14">
        <div className="mb-3 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
        <p className="text-xs uppercase ltr:tracking-[0.2em] rtl:text-sm text-primary font-semibold mb-3">
          {t('index.eyebrow')}
        </p>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 text-ink">
          {t('index.title')}
        </h1>
        <p className="text-muted text-lg max-w-2xl leading-relaxed">{t('index.lead')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((card, i) => (
          <ShowcaseCard
            key={card.id}
            href={card.href}
            icon={card.icon}
            index={String(i + 1).padStart(2, '0')}
            tag={t(`index.cards.${card.id}.tag`)}
            title={t(`index.cards.${card.id}.title`)}
            description={t(`index.cards.${card.id}.description`)}
            openLabel={t('index.open')}
          />
        ))}
      </div>

      <section className="relative mt-12 overflow-hidden rounded-2xl border border-primary/25 bg-surface p-6 sm:p-8 shadow-card">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ink mb-1">{t('index.ctaTitle')}</h2>
            <p className="text-sm text-muted max-w-xl leading-relaxed">{t('index.ctaBody')}</p>
          </div>
          <Link
            href="/#lead"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary shadow-glow-primary hover:brightness-110 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {t('index.ctaButton')}
            <ArrowLeft className="w-4 h-4 ltr:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </main>
  );
}

function ShowcaseCard({
  href,
  icon,
  index,
  tag,
  title,
  description,
  openLabel,
}: {
  href: string;
  icon: React.ReactNode;
  index: string;
  tag: string;
  title: string;
  description: string;
  openLabel: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-card hover:border-primary/40 hover:shadow-glow-primary transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px flow-stream" />
      <div className="flex items-center justify-between mb-6">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25 group-hover:bg-primary/20 transition-colors">
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-[0.15em] text-subtle font-semibold font-mono tabular-nums">
          {index}
        </span>
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary/80 mb-1.5">{tag}</p>
      <h2 className="font-bold text-lg mb-2 tracking-tight text-ink leading-snug">{title}</h2>
      <p className="text-sm text-muted leading-relaxed flex-1">{description}</p>

      <div className="mt-6 flex items-center justify-between text-xs">
        <span className="text-primary font-medium opacity-70 group-hover:opacity-100 transition-opacity">
          {openLabel}
        </span>
        <ArrowLeft
          className="w-4 h-4 text-subtle group-hover:text-primary transition-all ltr:rotate-180 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}
