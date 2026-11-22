import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { createServerCaller } from '@/lib/trpc/server';
import { LetterheadForm } from '../letterhead-form';
import { SectionForbidden } from '../_components/misc';
import { SectionHead, SettingAnchor } from '../_components/ui';
import { settingsViewer } from '../_lib/viewer';

/**
 * מכתבי בקשת זיכוי — the letterhead of the supplier credit-request letters.
 * Owner and manager edit; the bookkeeper reads; prefilled from the restaurant's
 * name and ח״פ until saved (as before).
 */
export async function LetterheadSettings() {
  const [t, viewer] = await Promise.all([getT(settingsMessages), settingsViewer()]);
  if (!viewer.seesRestaurant) return <SectionForbidden screen={t('areas.letterhead.title')} />;
  const caller = await createServerCaller();
  const [profile, letterhead] = await Promise.all([
    caller.settings.profile(),
    caller.settings.letterhead(),
  ]);
  return (
    <section aria-labelledby="settings-letterhead">
      <SectionHead
        title={<span id="settings-letterhead">{t('areas.letterhead.title')}</span>}
        subtitle={t('areas.letterhead.subtitle')}
        scope="restaurant"
        scopeLabel={t('scope.restaurant')}
      />
      <SettingAnchor id="letterhead">
        <LetterheadForm
          initial={{
            legalName: letterhead.legalName ?? profile.name,
            businessId:
              letterhead.businessId ??
              (/^\d{9}$/.test(profile.businessId ?? '') ? profile.businessId! : ''),
            address: letterhead.address ?? '',
            phone: letterhead.phone ?? '',
            email: letterhead.email ?? '',
          }}
          canEdit={viewer.role === 'owner' || viewer.role === 'manager'}
        />
      </SettingAnchor>
    </section>
  );
}
