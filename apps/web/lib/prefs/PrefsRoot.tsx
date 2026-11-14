import 'server-only';
import { headers } from 'next/headers';
import { userAgent } from 'next/server';
import type { UserRole } from '@restomatch/db';
import { PrefsProvider } from './PrefsProvider';
import { choicesFromCookieHeader, type DeviceHints, type DisplayChoices } from './schema';

/**
 * The display choices stored on the requesting device (server components).
 * Parsed from the raw `Cookie:` header with the same function the browser
 * store uses, so the server and the client never read two different values.
 */
export async function readDisplayChoices(): Promise<DisplayChoices> {
  return choicesFromCookieHeader((await headers()).get('cookie'));
}

/**
 * What the User-Agent tells about the device: a phone or tablet browser
 * (density renders at the regular size from the first HTML instead of being
 * corrected after hydration) and an Apple system (⌘ in shortcut labels). Only
 * the SSR snapshot: the browser's own media queries take over after hydration.
 * An iPad that reports a desktop User-Agent is corrected after hydration.
 */
export async function readDeviceHints(): Promise<DeviceHints> {
  const ua = userAgent({ headers: await headers() });
  const type = ua.device.type;
  const os = ua.os.name ?? '';
  return { coarse: type === 'mobile' || type === 'tablet', apple: os === 'Mac OS' || os === 'iOS' };
}

/**
 * Server entry of the display preferences: reads the `rm_display` cookie and
 * the device hints and renders `PrefsProvider`, so the first HTML already
 * carries the device's density, text size and shortcut choice (no flash).
 * Mount it once, around the whole dashboard shell (apps/web/app/dashboard/
 * layout.tsx, DS3-02), inside NavProvider; `role` may be omitted there (the
 * provider reads the viewer).
 */
export async function PrefsRoot({
  role,
  children,
}: {
  role?: UserRole | null;
  children: React.ReactNode;
}) {
  const [initial, hints] = await Promise.all([readDisplayChoices(), readDeviceHints()]);
  return (
    <PrefsProvider initial={initial} hints={hints} role={role}>
      {children}
    </PrefsProvider>
  );
}
