import { TRPCError } from '@trpc/server';
import { ExportsForm } from './form';

export default async function ExportsPage() {
  // Render form is client-side (downloads need user-initiated requests).
  // Server-side, we just check role visibility — bookkeeper or owner.
  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">ייצואים להנהלת חשבונות</h2>
      <p className="text-sm text-neutral-400 mb-6">
        ייצא חשבוניות שאושרו במערכת לקבצים מובנים — CSV לצרכים כלליים, או "קובץ 1000" עברית
        להעלאה ישירה לתוכנת ההנהח״ש.
      </p>
      <ExportsForm />
    </div>
  );
}

// Keep TRPCError import for future error handling
void TRPCError;
