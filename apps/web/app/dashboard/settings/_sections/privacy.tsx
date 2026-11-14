import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { DsrSection } from '../dsr';
import { SectionHead, SettingAnchor } from '../_components/ui';

/** פרטיות ונתונים — the person's own data: export it, or delete the account. Every role. */
export async function PrivacySettings() {
  const t = await getT(settingsMessages);
  return (
    <section aria-labelledby="settings-privacy">
      <SectionHead
        title={<span id="settings-privacy">{t('areas.privacy.title')}</span>}
        subtitle={t('areas.privacy.subtitle')}
        scope="user"
        scopeLabel={t('scope.user')}
      />
      <SettingAnchor id="dsr">
        <DsrSection />
      </SettingAnchor>
    </section>
  );
}
