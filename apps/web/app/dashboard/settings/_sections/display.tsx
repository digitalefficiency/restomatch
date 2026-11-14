import { cookies } from 'next/headers';
import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { RAIL_COOKIE } from '@/lib/nav/prefs';
import { DisplaySection } from '../_components/DisplaySection';
import { SectionHead } from '../_components/ui';

/** תצוגה — personal, per device, every role: density, text size, the side menu, single-key shortcuts. */
export async function DisplaySettings() {
  const [t, cookieStore] = await Promise.all([getT(settingsMessages), cookies()]);
  // The side menu's state comes from its own cookie (lib/nav/prefs.ts, DS3-02): read, never written here.
  const initialRail = cookieStore.get(RAIL_COOKIE)?.value === '1';
  return (
    <section aria-labelledby="settings-display">
      <SectionHead
        title={<span id="settings-display">{t('areas.display.title')}</span>}
        subtitle={t('areas.display.subtitle')}
        scope="device"
        scopeLabel={t('scope.device')}
      />
      <DisplaySection initialRail={initialRail} />
    </section>
  );
}
