import 'server-only';
import { cookies } from 'next/headers';
import type { UserRole } from '@restomatch/db';
import { PrefsProvider } from './PrefsProvider';
import { DISPLAY_COOKIE, parseDisplayChoices, type DisplayChoices } from './schema';

/** The display choices stored on the requesting device (server components). */
export async function readDisplayChoices(): Promise<DisplayChoices> {
  const raw = (await cookies()).get(DISPLAY_COOKIE)?.value;
  return parseDisplayChoices(raw);
}

/**
 * Server entry of the display preferences: reads the `rm_display` cookie and
 * renders `PrefsProvider`, so the first HTML already carries the device's
 * density, text size and shortcut choice (no flash). Mount it once, around the
 * whole dashboard shell (apps/web/app/dashboard/layout.tsx, DS3-02), inside
 * NavProvider; `role` may be omitted there (the provider reads the viewer).
 */
export async function PrefsRoot({ role, children }: { role?: UserRole | null; children: React.ReactNode }) {
  const initial = await readDisplayChoices();
  return (
    <PrefsProvider initial={initial} role={role}>
      {children}
    </PrefsProvider>
  );
}
