import { ShieldAlert } from 'lucide-react';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { LegalLinks } from '@/lib/legal/LegalLinks';

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
export type LegalDocStatus = 'draft' | 'approved';

export async function LegalShell({
  title,
  intro,
  lastUpdated,
  status = 'draft',
  children,
}: {
  title: string;
  intro?: string;
  /** Pre-formatted date (use `formatDate(value, locale)`); omit while unset. */
  lastUpdated?: string;
  /**
   * Counsel sign-off (G-11; H-02 flips it). While `draft` (the default) the
   * reviewer banner and the header review tag render; `approved` drops them.
   * Server components share no context: pass the SAME status to every
   * `<LegalClause>` on the page, or its clause tags stay.
   */
  status?: LegalDocStatus;
  children: React.ReactNode;
}) {
  const t = await getT(marketing);
  const tag = t('legal.shell.reviewTag');
  const draft = status === 'draft';
  return (
    <div className="mx-auto max-w-3xl px-6 py-16" data-legal-status={status}>
      {draft ? (
        <div
          role="note"
          className="mb-8 rounded-2xl border-s-4 border-gold bg-gold-subtle px-5 py-4 text-sm leading-relaxed text-ink"
        >
          <div className="mb-1 flex items-center gap-2 font-bold text-gold">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            {t('legal.shell.bannerTitle')}
          </div>
          <p className="text-muted">
            {t('legal.shell.bannerBeforeTag')}{' '}
            <span className="whitespace-nowrap rounded bg-surface-2 px-1.5 py-0.5 text-xs text-gold">
              {tag}
            </span>{' '}
            {t('legal.shell.bannerAfterTag')}
            {t.locale === 'en' ? <> {t('legal.shell.prevailingVersion')}</> : null}
          </p>
        </div>
      ) : null}

      <div className="mb-2 h-0.5 w-12 rounded-full flow-stream" aria-hidden="true" />
      <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{title}</h1>
      {intro ? <p className="mt-4 text-lg leading-relaxed text-muted">{intro}</p> : null}
      {lastUpdated || draft ? (
        <p className="mt-3 text-xs text-muted">
          {lastUpdated ? (
            <span className="num">{t('legal.shell.lastUpdated', { date: lastUpdated })}</span>
          ) : null}
          {lastUpdated && draft ? ' · ' : null}
          {draft ? tag : null}
        </p>
      ) : null}

      <div className="legal-body mt-10 space-y-8 text-[15px] leading-relaxed text-muted">
        {children}
      </div>

      <nav
        aria-labelledby="legal-related"
        className="mt-12 flex flex-wrap items-center gap-x-1 border-t border-line pt-6 text-sm text-muted"
      >
        <span id="legal-related">{t('legal.shell.related')}</span>
        <LegalLinks locale={t.locale} variant="inline-row" align="start" />
      </nav>
    </div>
  );
}

/**
 * A substantive legal clause. While the document is a `draft` (the default) the
 * review marker is appended automatically (in the active locale) so no clause
 * can ship untagged; pass the page's `status` so `approved` drops it.
 */
export async function LegalClause({
  status = 'draft',
  children,
}: {
  status?: LegalDocStatus;
  children: React.ReactNode;
}) {
  const t = await getT(marketing);
  return (
    <p>
      {children}
      {status === 'draft' ? (
        <>
          {' '}
          <span className="whitespace-nowrap text-xs text-gold">{t('legal.shell.reviewTag')}</span>
        </>
      ) : null}
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
