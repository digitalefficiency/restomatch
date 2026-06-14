import { TRPCError } from '@trpc/server';
import { SectionHeader } from '@/lib/components';
import { ExportsForm } from './form';

export default async function ExportsPage() {
  // Render form is client-side (downloads need user-initiated requests).
  // Server-side, we just check role visibility — bookkeeper or owner.
  return (
    <div>
      <SectionHeader
        title="ייצואים להנהלת חשבונות"
        subtitle={
          'ייצא חשבוניות שאושרו במערכת לקבצים מובנים — CSV לצרכים כלליים, או "קובץ 1000" עברית להעלאה ישירה לתוכנת ההנהח״ש.'
        }
      />
      <ExportsForm />
    </div>
  );
}

// Keep TRPCError import for future error handling
void TRPCError;
