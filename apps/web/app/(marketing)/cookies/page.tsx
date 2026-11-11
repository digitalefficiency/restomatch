import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/lib/i18n/messages/marketing';
import { getT } from '@/lib/i18n/server';
import { alternatesFor, metadataBase, socialFor } from '../_components/seo';
import { LegalShell, LegalSection, LegalClause } from '../_components/LegalShell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(marketing);
  return {
    title: t('legal.cookies.metaTitle'),
    description: t('legal.cookies.metaDescription'),
    metadataBase,
    alternates: alternatesFor('/cookies', t.locale),
    ...socialFor(t.locale, {
      title: t('legal.cookies.metaTitle'),
      description: t('legal.cookies.metaDescription'),
      path: '/cookies',
    }),
  };
}

/**
 * Cookie policy (E.3, pilot H-02). The complete list of what the app stores in
 * the browser, each row traced to its source: auth cookies
 * (lib/authCookies.ts), sign-out tombstone (lib/signOutTombstone.ts), locale
 * (lib/i18n/config.ts), consent (lib/cookieConsent.ts), sign-in/reset hints
 * (app/login/hintCodec.ts, app/(auth)/reset/resetHint.ts), nav rail
 * (lib/nav/prefs.ts), and on-device storage (lib/pwa/offlineQueue.ts,
 * lib/pwa/lineOutbox.ts, receiving wizard drafts, lead attribution). Production
 * cookie names carry the `__Secure-` / `__Host-` prefixes shown.
 * Copy: `marketing.legal.cookies.*`.
 */
const COOKIES = [
  { id: 'session', name: '__Secure-authjs.session-token', lifetime: 'session', category: 'essential' },
  { id: 'callback', name: '__Secure-authjs.callback-url', lifetime: 'browser', category: 'essential' },
  { id: 'csrf', name: '__Host-authjs.csrf-token', lifetime: 'browser', category: 'essential' },
  { id: 'signOut', name: 'rm_so', lifetime: 'days30', category: 'essential' },
  { id: 'loginHint', name: 'rm_login_hint', lifetime: 'min15', category: 'essential' },
  { id: 'resetHint', name: 'rm_reset_hint', lifetime: 'min15', category: 'essential' },
  { id: 'consent', name: 'rm_cookie_consent', lifetime: 'days180', category: 'essential' },
  { id: 'locale', name: 'rm_locale', lifetime: 'year1', category: 'preference' },
  { id: 'navRail', name: 'rm_nav_rail', lifetime: 'year1', category: 'preference' },
] as const;

const STORAGE = [
  { id: 'photoQueue', name: 'restomatch-receiver', where: 'IndexedDB', lifetime: 'untilUploaded' },
  { id: 'receiving', name: 'rm-rcv-draft:* · rm-rcv-lines:* · rm-rcv-unordered:*', where: 'localStorage', lifetime: 'untilDone' },
  { id: 'nav', name: 'rm:nav:rail · rm:nav:groups', where: 'localStorage', lifetime: 'untilCleared' },
  { id: 'attribution', name: 'rm.attribution', where: 'sessionStorage', lifetime: 'tab' },
  { id: 'temp', name: 'rm-pwa · …', where: 'sessionStorage', lifetime: 'tab' },
] as const;

const TH = 'px-4 py-2.5 text-start font-medium';
const TD = 'px-4 py-2.5 text-muted';

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
            <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className={TH}>{t('legal.cookies.s2.table.cookie')}</th>
                <th className={TH}>{t('legal.cookies.s2.table.purpose')}</th>
                <th className={TH}>{t('legal.cookies.s2.table.lifetime')}</th>
                <th className={TH}>{t('legal.cookies.s2.table.category')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COOKIES.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink" dir="ltr">
                    {c.name}
                  </td>
                  <td className={TD}>{t(`legal.cookies.s2.purpose.${c.id}`)}</td>
                  <td className={TD}>{t(`legal.cookies.s2.lifetime.${c.lifetime}`)}</td>
                  <td className={TD}>{t(`legal.cookies.s2.category.${c.category}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection heading={t('legal.cookies.storage.heading')}>
        <LegalClause>{t('legal.cookies.storage.c1')}</LegalClause>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-start text-sm">
            <thead className="border-b border-line bg-surface-2 font-mono text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className={TH}>{t('legal.cookies.storage.table.item')}</th>
                <th className={TH}>{t('legal.cookies.storage.table.where')}</th>
                <th className={TH}>{t('legal.cookies.storage.table.purpose')}</th>
                <th className={TH}>{t('legal.cookies.storage.table.lifetime')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {STORAGE.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink" dir="ltr">
                    {s.name}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted" dir="ltr">
                    {s.where}
                  </td>
                  <td className={TD}>{t(`legal.cookies.storage.purpose.${s.id}`)}</td>
                  <td className={TD}>{t(`legal.cookies.storage.lifetime.${s.lifetime}`)}</td>
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
