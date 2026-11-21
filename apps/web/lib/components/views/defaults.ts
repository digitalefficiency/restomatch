import 'server-only';
import type { UserRole } from '@restomatch/db';
import { readDeviceHints, readDisplayChoices } from '@/lib/prefs/server';
import { resolvePrefs, viewDensity } from '@/lib/prefs/schema';
import type { Density } from './state';

/**
 * The views' defaults from the device's display preference (DS3 WORKPLAN, "Personal preferences: one
 * contract"): the density chosen in הגדרות → תצוגה, else the role's default (D4), and the regular size
 * on a phone or tablet, where density is fixed. A page passes it to the parser and the address still
 * wins for that view:
 *
 *   const view = parseView(searchParams, await viewDefaults(role));
 *
 * Server components only (it reads the request's cookie and User-Agent through `@/lib/prefs/server`).
 */
export async function viewDefaults(role: UserRole | null | undefined): Promise<{ density: Density }> {
  const [choices, hints] = await Promise.all([readDisplayChoices(), readDeviceHints()]);
  const density = hints.coarse ? 'regular' : resolvePrefs(choices, role).density;
  return { density: viewDensity(density) };
}
