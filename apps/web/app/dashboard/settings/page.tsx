import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { settings as settingsMessages } from '@/lib/i18n/messages/settings';
import { LegacyHashRedirect } from './_components/misc';
import { sectionById, sectionFromParam } from './_index/sections';
import { AccountSettings } from './_sections/account';
import { DisplaySettings } from './_sections/display';
import { LetterheadSettings } from './_sections/letterhead';
import { PrivacySettings } from './_sections/privacy';
import { RestaurantSettings } from './_sections/restaurant';
import { RulesSettings } from './_sections/rules';
import { SecuritySettings } from './_sections/security';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [t, sp] = await Promise.all([getT(settingsMessages), searchParams]);
  const section = sectionById(sectionFromParam(sp.s));
  const tt = t as unknown as (k: string) => string;
  return { title: `${tt(section.titleKey)} · ${t('title')} — RestoMatch` };
}

/**
 * Settings (DS3-06, SPEC §10.5). One route; the open section is in the address
 * (`?s=rules`), so a section is shareable, survives Back, and every setting has
 * a link (`?s=rules#qtyPercent`) for the search field and the command palette.
 * No `?s` opens "תצוגה", the first section of "אני", for every role. The frame
 * (title, search, the two groups) is the layout. Each section re-checks the
 * role on the server; restaurant sections are owner-edit / manager+bookkeeper
 * read-only / absent for receiver and chef, as before.
 */
export default async function SettingsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const id = sectionFromParam(sp.s);
  return (
    <>
      <LegacyHashRedirect />
      {id === 'account' ? (
        <AccountSettings />
      ) : id === 'security' ? (
        <SecuritySettings />
      ) : id === 'privacy' ? (
        <PrivacySettings />
      ) : id === 'restaurant' ? (
        <RestaurantSettings />
      ) : id === 'letterhead' ? (
        <LetterheadSettings />
      ) : id === 'rules' ? (
        <RulesSettings />
      ) : (
        <DisplaySettings />
      )}
    </>
  );
}
