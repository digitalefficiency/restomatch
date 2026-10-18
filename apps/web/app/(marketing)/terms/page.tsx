import type { Metadata } from 'next';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { alternatesFor, metadataBase } from '../_components/seo';
import { LegalShell, LegalSection, LegalClause } from '../_components/LegalShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('legal.terms.metaTitle'),
    description: t('legal.terms.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/terms', t.locale),
  };
}

/**
 * Terms of service (E.2). Bilingual (Hebrew prevails) skeleton — service
 * description, account responsibility, billing, IP, liability framing,
 * governing law. Copy: `marketing.legal.terms.*`. Every clause tagged for legal
 * review; no warranty, SLA figure, or jurisdiction is asserted as binding fact.
 */
export default async function TermsPage() {
  const t = await getT(marketing);
  return (
    <LegalShell title={t('legal.terms.title')} intro={t('legal.terms.intro')}>
      <LegalSection heading={t('legal.terms.s1.heading')}>
        <LegalClause>{t('legal.terms.s1.c1')}</LegalClause>
        <LegalClause>{t('legal.terms.s1.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s2.heading')}>
        <LegalClause>{t('legal.terms.s2.c1')}</LegalClause>
        <LegalClause>{t('legal.terms.s2.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s3.heading')}>
        <LegalClause>{t('legal.terms.s3.c1')}</LegalClause>
        <LegalClause>{t('legal.terms.s3.c2')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s4.heading')}>
        <LegalClause>{t('legal.terms.s4.c1')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s5.heading')}>
        <LegalClause>{t('legal.terms.s5.c1')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s6.heading')}>
        <LegalClause>{t('legal.terms.s6.c1')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s7.heading')}>
        <LegalClause>{t('legal.terms.s7.c1')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s8.heading')}>
        <LegalClause>{t('legal.terms.s8.c1')}</LegalClause>
      </LegalSection>

      <LegalSection heading={t('legal.terms.s9.heading')}>
        <LegalClause>{t('legal.terms.s9.c1')}</LegalClause>
      </LegalSection>
    </LegalShell>
  );
}
