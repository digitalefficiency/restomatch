import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { countUnusedRecoveryCodes, isTwoFactorEnabled } from '@/lib/totp';
import { TwoFactorSection } from '../TwoFactorSection';
import { SectionHead, SettingAnchor } from '../_components/ui';
import { settingsViewer } from '../_lib/viewer';

/** אבטחה — two-factor sign-in, for every role (a receiver must be able to turn it on). */
export async function SecuritySettings() {
  const [t, viewer] = await Promise.all([getT(settingsMessages), settingsViewer()]);
  const [enabled, remaining] = viewer.userId
    ? await Promise.all([isTwoFactorEnabled(viewer.userId), countUnusedRecoveryCodes(viewer.userId)])
    : [false, 0];
  return (
    <section aria-labelledby="settings-security">
      <SectionHead
        title={<span id="settings-security">{t('areas.security.title')}</span>}
        subtitle={t('areas.security.subtitle')}
        scope="user"
        scopeLabel={t('scope.user')}
      />
      <SettingAnchor id="twofa">
        <TwoFactorSection initialEnabled={enabled} recoveryRemaining={remaining} />
      </SettingAnchor>
    </section>
  );
}
