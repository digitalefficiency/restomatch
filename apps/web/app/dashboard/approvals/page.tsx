import { createServerCaller } from '@/lib/trpc/server';
import { ApprovalsList } from './list';

export default async function ApprovalsPage() {
  const caller = await createServerCaller();
  const queue = await caller.approvals.myQueue({ limit: 100 });

  return (
    <div>
      <h2 className="text-2xl font-bold mb-2">תור אישורים</h2>
      <p className="text-sm text-slate-500 mb-6">
        חריגות שמחכות להחלטה שלך. אישור = הופך לחיסכון. דחייה = משאיר את החריגה כהפסד אך מתעד את ההחלטה.
      </p>

      {queue.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
          אין חריגות בתור כרגע. ✓
        </div>
      ) : (
        <ApprovalsList initial={queue} />
      )}
    </div>
  );
}
