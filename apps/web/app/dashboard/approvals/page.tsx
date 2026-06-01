import { CheckCircle2 } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { EmptyState, SectionHeader } from '@/lib/components';
import { ApprovalsList } from './list';

export default async function ApprovalsPage() {
  const caller = await createServerCaller();
  const queue = await caller.approvals.myQueue({ limit: 100 });

  return (
    <div>
      <SectionHeader
        title="תור אישורים"
        subtitle="חריגות שמחכות להחלטה שלך. אישור = הופך לחיסכון. דחייה = משאיר את החריגה כהפסד אך מתעד את ההחלטה."
      />

      {queue.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          title="אין חריגות בתור כרגע"
          description="כל ההפרשים טופלו. חריגות חדשות יופיעו כאן ברגע שהמערכת תזהה אותן בקבלות ובחשבוניות."
        />
      ) : (
        <ApprovalsList initial={queue} />
      )}
    </div>
  );
}
