import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { getT } from '@/lib/i18n/server';
import { hasPassword } from '@/lib/passwords';
import { countUnusedRecoveryCodes, isTwoFactorEnabled } from '@/lib/totp';
import { AccountSection } from './account-section';
import { SettingsForm } from './form';
import { ProfileForm } from './profile-form';
import { DsrSection } from './dsr';
import { TwoFactorSection } from './TwoFactorSection';

/**
 * Settings. PERSONAL sections (language, password, devices, 2FA, DSR) are for
 * every role — a receiver must be able to turn on 2FA or set a password. The
 * RESTAURANT sections are owner-editable, read-only for manager + bookkeeper,
 * and hidden from receiver + chef (least privilege: they never need VAT or
 * matching tolerances).
 */
export default async function SettingsPage() {
  const caller = await createServerCaller();
  const [memberships, session, t] = await Promise.all([
    caller.onboarding.myMemberships(),
    auth(),
    getT(settingsMessages),
  ]);

  const userId = session?.user?.id;
  const [twoFactorEnabled, recoveryRemaining, passwordSet] = userId
    ? await Promise.all([isTwoFactorEnabled(userId), countUnusedRecoveryCodes(userId), hasPassword(userId)])
    : [false, 0, false];

  // Resolve the caller's role on the active restaurant (matching the layout's
  // selection) to decide between editable / read-only / hidden.
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const role = active?.role ?? null;
  const isOwner = role === 'owner';
  const seesRestaurant = role === 'owner' || role === 'manager' || role === 'bookkeeper';

  const [restaurantSettings, profile] = seesRestaurant
    ? await Promise.all([caller.settings.get(), caller.settings.profile()])
    : [null, null];

  return (
    <div className="space-y-10">
      <div>
        <SectionHeader title={t('sections.accountTitle')} subtitle={t('sections.accountSubtitle')} />
        <AccountSection hasPassword={passwordSet} />
      </div>
      <div>
        <SectionHeader title={t('sections.securityTitle')} subtitle={t('sections.securitySubtitle')} />
        <TwoFactorSection initialEnabled={twoFactorEnabled} recoveryRemaining={recoveryRemaining} />
      </div>
      {profile ? (
        <div>
          <SectionHeader title={t('sections.profileTitle')} subtitle={t('sections.profileSubtitle')} />
          <ProfileForm initial={profile} canEdit={isOwner} />
        </div>
      ) : null}
      {restaurantSettings ? (
        <div>
          <SectionHeader title={t('sections.matchingTitle')} subtitle={t('sections.matchingSubtitle')} />
          <SettingsForm initial={restaurantSettings} canEdit={isOwner} />
        </div>
      ) : null}
      <div>
        <SectionHeader title={t('sections.privacyTitle')} subtitle={t('sections.privacySubtitle')} />
        <DsrSection />
      </div>
    </div>
  );
}
