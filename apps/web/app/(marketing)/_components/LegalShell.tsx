import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';

/**
 * Shared chrome for the legal pages (privacy / terms / cookies). Renders a
 * prominent reviewer banner making it unmistakable that the copy is a
 * placeholder draft pending counsel sign-off, and a legend for the
 * review marker (`[לאימות עו"ד]` / `[pending legal review]`) that tags every
 * substantive legal sentence. Copy lives in `marketing.legal.*`; layout uses
 * logical (start/end) utilities so it works in RTL Hebrew and LTR English.
 *
 * IMPORTANT (engineering note, not legal advice): the page bodies contain NO
 * invented statutory citations, deadlines, or guarantees — only structure and
 * neutral descriptions, each sentence tagged for a lawyer to verify or replace.
 */
export async function LegalShell({
  title,
  intro,
  lastUpdated,
  children,
}: {
  title: string;
  intro?: string;
  /** Pre-formatted date (use `formatDate(value, locale)`); omit while unset. */
  lastUpdated?: string;
  children: React.ReactNode;
}) {
  const t = await getT(marketing);
  const tag = t('legal.shell.reviewTag');
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div
        role="note"
        className="mb-8 rounded-2xl border-s-4 border-gold bg-gold/8 px-5 py-4 text-sm leading-relaxed text-ink"
      >
        <div className="mb-1 flex items-center gap-2 font-bold text-gold">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          {t('legal.shell.bannerTitle')}
        </div>
        <p className="text-muted">
          {t('legal.shell.bannerBeforeTag')}{' '}
          <span className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-gold">
            {tag}
          </span>{' '}
          {t('legal.shell.bannerAfterTag')}
          {t.locale === 'en' ? <> {t('legal.shell.prevailingVersion')}</> : null}
        </p>
      </div>

      <div className="mb-2 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
      <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {intro ? <p className="mt-4 text-lg leading-relaxed text-muted">{intro}</p> : null}
      <p className="mt-3 font-mono text-xs tabular-nums text-muted">
        {t('legal.shell.lastUpdated', { date: lastUpdated ?? t('legal.shell.notSet') })} · {tag}
      </p>

      <div className="legal-body mt-10 space-y-8 text-[15px] leading-relaxed text-muted">
        {children}
      </div>

      <div className="mt-12 border-t border-line pt-6 text-sm text-muted">
        {t('legal.shell.related')}{' '}
        <Link href="/privacy" className="text-muted underline hover:text-ink">
          {t('legal.shell.linkPrivacy')}
        </Link>
        {' · '}
        <Link href="/terms" className="text-muted underline hover:text-ink">
          {t('legal.shell.linkTerms')}
        </Link>
        {' · '}
        <Link href="/cookies" className="text-muted underline hover:text-ink">
          {t('legal.shell.linkCookies')}
        </Link>
      </div>
    </div>
  );
}

/**
 * A substantive legal clause. The review marker is appended automatically (in
 * the active locale) so no clause can ship untagged.
 */
export async function LegalClause({ children }: { children: React.ReactNode }) {
  const t = await getT(marketing);
  return (
    <p>
      {children}{' '}
      <span className="whitespace-nowrap font-mono text-xs text-gold/80">{t('legal.shell.reviewTag')}</span>
    </p>
  );
}

/** A titled legal section. */
export function LegalSection({
  id,
  heading,
  children,
}: {
  id?: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-xl font-bold text-ink">{heading}</h2>
      {children}
    </section>
  );
}
