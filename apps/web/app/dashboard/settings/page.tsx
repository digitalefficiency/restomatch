import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { SectionHeader } from '@/lib/components';
import { SettingsForm } from './form';
import { ProfileForm } from './profile-form';
import { DsrSection } from './dsr';

export default async function SettingsPage() {
  const caller = await createServerCaller();
  const [settings, profile, memberships, session] = await Promise.all([
    caller.settings.get(),
    caller.settings.profile(),
    caller.onboarding.myMemberships(),
    auth(),
  ]);

  // Both editors are owner-only; resolve the caller's role on the active
  // restaurant (matching the layout's selection) to decide between an editable
  // form and a read-only view.
  const active =
    memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0];
  const isOwner = (active?.role ?? null) === 'owner';

  return (
    <div className="space-y-10">
      <div>
        <SectionHeader
          title="פרטי המסעדה"
          subtitle="שם, ח״פ, שיעור מע״מ ואזור זמן — נושאי משקל לחישוב הדליפה ולגבולות היום."
        />
        <ProfileForm initial={profile} canEdit={isOwner} />
      </div>
      <div>
        <SectionHeader
          title="הגדרות התאמה"
          subtitle="ספי הסבילות והאישורים שמכתיבים מתי חריגה נחסמת, נכנסת לתור או מאושרת אוטומטית."
        />
        <SettingsForm initial={settings} canEdit={isOwner} />
      </div>
      <div>
        <SectionHeader
          title="פרטיות ונתונים אישיים"
          subtitle="ייצוא הנתונים האישיים שלכם או מחיקת החשבון — מימוש זכויות נושא המידע."
        />
        <DsrSection />
      </div>
    </div>
  );
}
