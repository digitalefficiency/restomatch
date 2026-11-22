import { PrefsRoot } from '@/lib/prefs/server';
import { SettingsFrame } from './_components/SettingsFrame';
import { settingsViewer } from './_lib/viewer';

/**
 * Settings (DS3-06, SPEC §10.5): one frame for every section route — the title,
 * the search field and the sections in two groups — with the open section as
 * `children`. The frame stays mounted while sections change.
 *
 * PrefsRoot is mounted here until the dashboard shell mounts it for the whole
 * product (request to DS3-02, apps/web/app/dashboard/layout.tsx); a nested
 * provider passes through, so both mounts together are harmless.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const viewer = await settingsViewer();
  return (
    <PrefsRoot role={viewer.role}>
      <SettingsFrame role={viewer.role}>{children}</SettingsFrame>
    </PrefsRoot>
  );
}
