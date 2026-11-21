import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { hasPassword } from '@/lib/passwords';
import { createServerCaller } from '@/lib/trpc/server';
import { AccountSection } from '../account-section';
import { PhoneSection } from '../phone-section';
import { SectionHead } from '../_components/ui';
import { settingsViewer } from '../_lib/viewer';

/** חשבון — the person's own sign-in details, on every device: language, password, devices, phone. Every role. */
export async function AccountSettings() {
  const [t, viewer, caller] = await Promise.all([
    getT(settingsMessages),
    settingsViewer(),
    createServerCaller(),
  ]);
  const [passwordSet, myPhone] = await Promise.all([
    viewer.userId ? hasPassword(viewer.userId) : Promise.resolve(false),
    caller.settings.myPhone(),
  ]);
  return (
    <section aria-labelledby="settings-account" className="space-y-4">
      <SectionHead
        title={<span id="settings-account">{t('areas.account.title')}</span>}
        subtitle={t('areas.account.subtitle')}
        scope="user"
        scopeLabel={t('scope.user')}
      />
      <AccountSection hasPassword={passwordSet} />
      <PhoneSection initial={myPhone.phone} />
    </section>
  );
}
