import { CheckCircle2 } from 'lucide-react';
import { createServerCaller } from '@/lib/trpc/server';
import { EmptyState, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { approvals } from '@/lib/i18n/messages/approvals';
import { ApprovalsList } from './list';

export default async function ApprovalsPage() {
  const caller = await createServerCaller();
  const t = await getT(approvals);
  const queue = await caller.approvals.myQueue({ limit: 50 });

  return (
    <div>
      <SectionHeader level={1} title={t('title')} subtitle={t('subtitle')} />

      {queue.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          title={t('empty.title')}
          description={t('empty.description')}
        />
      ) : (
        <ApprovalsList initial={queue} />
      )}
    </div>
  );
}
