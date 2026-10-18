import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { alternatesFor, metadataBase } from '../_components/seo';
import { LegalShell, LegalSection, LegalClause } from '../_components/LegalShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('legal.privacy.metaTitle'),
    description: t('legal.privacy.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/privacy', t.locale),
  };
}

/**
 * Privacy policy (E.1). Bilingual (Hebrew prevails) skeleton covering the
 * duty-to-inform topics — controller identity, PII categories, purposes,
 * sub-processors, cross-border transfer, retention, data-subject rights,
 * cookies, contact/DPO. Copy: `marketing.legal.privacy.*`. Every substantive
 * sentence is tagged for legal review; no statutory citation, deadline, or
 * guarantee is asserted as fact.
 */
const SUBPROCESSORS = [
  { name: 'Supabase', purpose: 'supabase', country: 'unknown' },
  { name: 'Resend', purpose: 'resend', country: 'unknown' },
  { name: 'Anthropic', purpose: 'anthropic', country: 'us' },
  { name: 'Google Document AI', purpose: 'googleDocAi', country: 'unknown' },
  { name: 'Upstash', purpose: 'upstash', country: 'unknown' },
  { name: 'Vercel', purpose: 'vercel', country: 'unknown' },
  { name: 'Fly.io', purpose: 'fly', country: 'unknown' },
  { name: 'Sentry', purpose: 'sentry', country: 'unknown' },
  { name: 'Higgsfield', purpose: 'higgsfield', country: 'unknown' },
] as const;

export default async function PrivacyPolicyPage() {
  const t = await getT(marketing);
  return (
    <LegalShell title={t('legal.privacy.title')} intro={t('legal.privacy.intro')}>
      <LegalSection heading={t('legal.privacy.s1.heading')}>
        <LegalClause>{t('legal.privacy.s1.c1')}</LegalClause>
        <LegalClause>{t('legal.privacy.s1.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s2.heading')}>
        <LegalClause>{t('legal.privacy.s2.c1')}</LegalClause>
        <LegalClause>{t('legal.privacy.s2.c2')}</LegalClause>
        <LegalClause>{t('legal.privacy.s2.c3')}</LegalClause>
        <LegalClause>{t('legal.privacy.s2.c4')}</LegalClause>
        <LegalClause>{t('legal.privacy.s2.c5')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s3.heading')}>
        <LegalClause>{t('legal.privacy.s3.c1')}</LegalClause>
        <LegalClause>{t('legal.privacy.s3.c2')}</LegalClause>
        <LegalClause>{t('legal.privacy.s3.c3')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s4.heading')}>
        <LegalClause>{t('legal.privacy.s4.c1')}</LegalClause>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2.5 text-start font-medium">{t('legal.privacy.s4.table.provider')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('legal.privacy.s4.table.purpose')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('legal.privacy.s4.table.country')}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t('legal.privacy.s4.table.dpa')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td className="px-4 py-2.5 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-2.5 text-muted">{t(`legal.privacy.s4.purpose.${s.purpose}`)}</td>
                  <td className="px-4 py-2.5 text-muted">{t(`legal.privacy.s4.country.${s.country}`)}</td>
                  <td className="px-4 py-2.5 text-muted">{t('legal.privacy.s4.dpaStatus.inReview')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LegalClause>{t('legal.privacy.s4.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s5.heading')}>
        <LegalClause>{t('legal.privacy.s5.c1')}</LegalClause>
        <LegalClause>{t('legal.privacy.s5.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s6.heading')}>
        <LegalClause>{t('legal.privacy.s6.c1')}</LegalClause>
        <LegalClause>{t('legal.privacy.s6.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s7.heading')}>
        <LegalClause>{t('legal.privacy.s7.c1')}</LegalClause>
        <LegalClause>{t('legal.privacy.s7.c2')}</LegalClause>
        <p>
          {t('legal.privacy.s7.accountPrefix')}{' '}
          <Link href="/dashboard/settings" className="text-primary underline">
            {t('legal.privacy.s7.accountLink')}
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s8.heading')}>
        <LegalClause>{t('legal.privacy.s8.c1')}</LegalClause>
        <p>
          {t('legal.privacy.s8.detailsPrefix')}{' '}
          <Link href="/cookies" className="text-primary underline">
            {t('legal.privacy.s8.detailsLink')}
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s9.heading')}>
        <LegalClause>{t('legal.privacy.s9.c1')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.privacy.s10.heading')}>
        <LegalClause>{t('legal.privacy.s10.c1')}</LegalClause>
      </LegalSection>
    </LegalShell>
  );
}
