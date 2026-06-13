import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { SettingsForm } from './form';

export default async function SettingsPage() {
  const caller = await createServerCaller();
  const [settings, memberships, session] = await Promise.all([
    caller.settings.get(),
    caller.onboarding.myMemberships(),
    auth(),
  ]);

  // settings.update is owner-only; resolve the caller's role on the active
  // restaurant (matching the layout's selection) to decide between an editable
  // form and a read-only view.
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const isOwner = (active?.role ?? null) === 'owner';

  return (
    <div>
      <SectionHeader
        title="הגדרות התאמה"
        subtitle="ספי הסבילות והאישורים שמכתיבים מתי חריגה נחסמת, נכנסת לתור או מאושרת אוטומטית."
      />
      <SettingsForm initial={settings} canEdit={isOwner} />
    </div>
  );
}
