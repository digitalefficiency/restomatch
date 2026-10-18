import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { alternatesFor, metadataBase } from '../_components/seo';
import { LegalShell, LegalSection, LegalClause } from '../_components/LegalShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('legal.cookies.metaTitle'),
    description: t('legal.cookies.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/cookies'),
  };
}

/**
 * Cookie policy (E.3). Discloses the strictly-necessary Auth.js session/CSRF
 * cookies (always set) and the consent cookie; analytics cookies are listed as
 * gated behind opt-in. Copy: `marketing.legal.cookies.*`. Every substantive
 * sentence tagged for legal review.
 */
const COOKIES = [
  { id: 'session', name: 'authjs.session-token / __Secure-authjs.session-token', category: 'essential' },
  { id: 'csrf', name: 'authjs.csrf-token', category: 'essential' },
  { id: 'consent', name: 'rm_cookie_consent', category: 'essential' },
  { id: 'analytics', name: null, category: 'nonEssential' },
] as const;

export default async function CookiePolicyPage() {
  const t = await getT(marketing);
  return (
    <LegalShell title={t('legal.cookies.title')} intro={t('legal.cookies.intro')}>
      <LegalSection heading={t('legal.cookies.s1.heading')}>
        <LegalClause>{t('legal.cookies.s1.c1')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.cookies.s2.heading')}>
        <LegalClause>{t('legal.cookies.s2.c1')}</LegalClause>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-subtle">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('legal.cookies.s2.table.cookie')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('legal.cookies.s2.table.purpose')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('legal.cookies.s2.table.category')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COOKIES.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink" dir={c.name ? 'ltr' : undefined}>
                    {c.name ?? t('legal.cookies.s2.analyticsName')}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{t(`legal.cookies.s2.purpose.${c.id}`)}</td>
                  <td className="px-4 py-2.5 text-subtle">{t(`legal.cookies.s2.category.${c.category}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection heading={t('legal.cookies.s3.heading')}>
        <LegalClause>{t('legal.cookies.s3.c1')}</LegalClause>
        <LegalClause>{t('legal.cookies.s3.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.cookies.s4.heading')}>
        <p>
          {t('legal.cookies.s4.morePrefix')}{' '}
          <Link href="/privacy" className="text-primary underline">
            {t('legal.cookies.s4.moreLink')}
          </Link>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
