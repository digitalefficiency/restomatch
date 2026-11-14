import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { createServerCaller } from '@/lib/trpc/server';
import { ReferralCard } from '@/lib/growth/ReferralCard';
import { ProfileForm } from '../profile-form';
import { SectionForbidden } from '../_components/misc';
import { SectionHead, SettingAnchor } from '../_components/ui';
import { settingsViewer } from '../_lib/viewer';

/**
 * פרטי המסעדה — name, ח״פ, VAT rate (changed only through its dialog) and time
 * zone. Owner edits; manager and bookkeeper read; receiver and chef never see
 * it. The referral programme (flag `growth`) sits here for owner and manager.
 */
export async function RestaurantSettings() {
  const [t, viewer] = await Promise.all([getT(settingsMessages), settingsViewer()]);
  if (!viewer.seesRestaurant) return <SectionForbidden />;
  const caller = await createServerCaller();
  const profile = await caller.settings.profile();
  const referralOn = (viewer.role === 'owner' || viewer.role === 'manager') && viewer.features.includes('growth');
  return (
    <section aria-labelledby="settings-restaurant" className="space-y-6">
      <SectionHead
        title={<span id="settings-restaurant">{t('areas.restaurant.title')}</span>}
        subtitle={t('areas.restaurant.subtitle')}
        scope="restaurant"
        scopeLabel={t('scope.restaurant')}
      />
      <SettingAnchor id="profile">
        <ProfileForm initial={profile} canEdit={viewer.isOwner} />
      </SettingAnchor>
      {referralOn ? <ReferralCard canRedeem={viewer.isOwner} /> : null}
    </section>
  );
}
