import type { Metadata } from 'next';
import { Mail, MessageCircle, Phone } from 'lucide-react';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { formatDate } from '@/lib/i18n/format';
import { accessibilityCoordinator, contactChannels, whatsappHref } from '@/lib/contact';
import { alternatesFor, metadataBase, socialFor } from '../_components/seo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('a11y.metaTitle'),
    description: t('a11y.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/accessibility', t.locale),
    ...socialFor(t.locale, {
      title: t('a11y.metaTitle'),
      description: t('a11y.metaDescription'),
      path: '/accessibility',
    }),
  };
}

/** Date of the latest accessibility review (the 2026-10-25 UX/a11y review, docs/ux/). Update on every re-audit. */
const A11Y_AUDIT_DATE = '2026-10-25';
/** Date this statement was last changed. */
const A11Y_STATEMENT_UPDATED = '2026-10-25';

const ARRANGEMENTS = [
  'skip',
  'keyboard',
  'motion',
  'forms',
  'language',
  'receiver',
  'noOverlay',
] as const;
const GAPS = ['focus', 'obscured', 'showcase', 'alerts', 'numbers', 'scans'] as const;

/**
 * הצהרת נגישות (W1-12 · mkt-02, a11y-01; Israeli Service Accessibility
 * Regulations, reg. 35). States the ACTUAL conformance — partial, against a
 * ת״י 5568 AA / WCAG 2.2 AA target — how and when it was tested, the known
 * gaps (seeded from docs/ux/review), and the coordinator with a 5-business-day
 * SLA. Owner-supplied facts that are still missing render as visibly marked
 * placeholders ("[שם רכז/ת הנגישות]"); they come from env (lib/contact.ts).
 * No overlay widget, by design.
 */
export default async function AccessibilityStatementPage() {
  const t = await getT(marketing);
  const date = (iso: string) =>
    formatDate(`${iso}T12:00:00Z`, t.locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const coordinator = accessibilityCoordinator();
  const channels = contactChannels();
  const wa = channels.whatsapp
    ? whatsappHref(channels.whatsapp.digits, t('shell.whatsappText'))
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16">
      <p className="mb-2 text-sm font-semibold text-primary">{t('a11y.eyebrow')}</p>
      <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
        {t('a11y.title')}
      </h1>
      <p className="mt-3 text-sm tabular-nums text-muted">
        {t('a11y.updated', { date: date(A11Y_STATEMENT_UPDATED) })}
      </p>
      <p className="mt-6 text-lg leading-relaxed text-muted">{t('a11y.intro')}</p>
      <p className="mt-3 text-sm text-muted">
        {t('a11y.operatorLabel')}: <Placeholder>{t('a11y.operatorPlaceholder')}</Placeholder>
      </p>

      <div className="mt-10 space-y-10 text-base leading-relaxed text-muted">
        <Section id="level" heading={t('a11y.levelTitle')}>
          <p>{t('a11y.levelBody')}</p>
          <p
            className="rounded-xl border-s-4 border-warn bg-surface-2 px-4 py-3 font-medium text-ink"
            data-testid="a11y-conformance"
          >
            {t('a11y.levelStatus')}
          </p>
        </Section>

        <Section id="scope" heading={t('a11y.scopeTitle')}>
          <p>{t('a11y.scopeBody')}</p>
        </Section>

        <Section id="audit" heading={t('a11y.auditTitle')}>
          <p className="tabular-nums">{t('a11y.auditDate', { date: date(A11Y_AUDIT_DATE) })}</p>
          <p>{t('a11y.auditWho')}</p>
          <ul className="list-disc space-y-2 ps-5">
            <li>{t('a11y.auditMethods')}</li>
            <li>{t('a11y.auditBrowsers')}</li>
            <li>{t('a11y.auditAt')}</li>
          </ul>
        </Section>

        <Section id="arrangements" heading={t('a11y.arrangementsTitle')}>
          <ul className="list-disc space-y-2 ps-5">
            {ARRANGEMENTS.map((k) => (
              <li key={k}>{t(`a11y.arrangements.${k}`)}</li>
            ))}
          </ul>
        </Section>

        <Section id="gaps" heading={t('a11y.gapsTitle')}>
          <p>{t('a11y.gapsIntro')}</p>
          <ul className="list-disc space-y-2 ps-5">
            {GAPS.map((k) => (
              <li key={k}>{t(`a11y.gaps.${k}`)}</li>
            ))}
          </ul>
        </Section>

        <Section id="contact" heading={t('a11y.contactTitle')}>
          <p>{t('a11y.contactBody')}</p>
          <div
            className="rounded-2xl border border-line bg-surface p-5 shadow-card"
            data-testid="a11y-coordinator"
          >
            <h3 className="text-base font-bold text-ink">{t('a11y.coordinatorTitle')}</h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-medium text-ink">{t('a11y.coordinatorName')}</dt>
              <dd>{coordinator.name ?? <Placeholder>{t('a11y.placeholderName')}</Placeholder>}</dd>
              <dt className="font-medium text-ink">{t('a11y.coordinatorPhone')}</dt>
              <dd>
                {coordinator.phone ? (
                  <a
                    href={`tel:${coordinator.phone.replace(/[^\d+]/g, '')}`}
                    className="text-primary underline"
                  >
                    <bdi dir="ltr">{coordinator.phone}</bdi>
                  </a>
                ) : (
                  <Placeholder>{t('a11y.placeholderPhone')}</Placeholder>
                )}
              </dd>
              <dt className="font-medium text-ink">{t('a11y.coordinatorEmail')}</dt>
              <dd>
                {coordinator.email ? (
                  <a href={`mailto:${coordinator.email}`} className="text-primary underline">
                    <bdi dir="ltr">{coordinator.email}</bdi>
                  </a>
                ) : (
                  <Placeholder>{t('a11y.placeholderEmail')}</Placeholder>
                )}
              </dd>
            </dl>
            <p className="mt-4 text-sm font-medium text-ink">{t('a11y.sla')}</p>
          </div>
          {wa || channels.phone || channels.email ? (
            <div>
              <p>{t('a11y.otherChannels')}</p>
              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                {wa ? (
                  <li>
                    <a href={wa} target="_blank" rel="noopener noreferrer" className={chip}>
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      {t('shell.whatsappLabel')}
                    </a>
                  </li>
                ) : null}
                {channels.phone ? (
                  <li>
                    <a href={channels.phone.href} className={chip}>
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      <bdi dir="ltr">{channels.phone.display}</bdi>
                    </a>
                  </li>
                ) : null}
                {channels.email ? (
                  <li>
                    <a href={channels.email.href} className={chip}>
                      <Mail className="h-4 w-4" aria-hidden="true" />
                      <bdi dir="ltr">{channels.email.address}</bdi>
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

const chip =
  'inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 font-medium text-ink hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function Section({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-3">
      <h2 id={`${id}-title`} className="text-xl font-bold text-ink">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/** An owner-supplied value that is still missing: unmistakable on the page, trivial to grep. */
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-placeholder
      className="rounded bg-warn/10 px-1.5 py-0.5 font-semibold text-ink ring-1 ring-warn/40"
    >
      {children}
    </span>
  );
}
