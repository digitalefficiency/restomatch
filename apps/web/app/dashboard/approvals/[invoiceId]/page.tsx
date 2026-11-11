import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { createServerCaller } from '@/lib/trpc/server';
import { LinkButton, SectionHeader } from '@/lib/components';
import { getT } from '@/lib/i18n/server';
import { approvals } from '@/lib/i18n/messages/approvals';
import { ApprovalsList } from '../list';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * W2-04 §5.7 — the mobile landing of a push / e-mail ("דרושה החלטה"): ONE
 * invoice's gaps, one thumb card at a time, the 50/50 48 px pair pinned to
 * the bottom; deciding brings up the next card. The same decision path as the
 * queue (`ApprovalsList` in landing mode). A foreign invoice id simply has no
 * rows (the queue's `invoiceIds` filter is tenant-scoped) → the done state.
 */
export default async function ApprovalInvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  if (!UUID.test(invoiceId)) notFound();
  const filters = { invoiceIds: [invoiceId] };
  const caller = await createServerCaller();
  const [t, queue, summary, session, memberships] = await Promise.all([
    getT(approvals),
    caller.approvals.myQueue({ limit: 50, ...filters }),
    caller.approvals.queueSummary(filters),
    auth(),
    caller.onboarding.myMemberships(),
  ]);
  const viewerRole =
    (memberships.find((m) => m.restaurantId === session?.user?.restaurantId) ?? memberships[0])?.role ?? null;
  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader
        level={1}
        title={t('desk.landingTitle')}
        action={
          <LinkButton href="/dashboard/approvals" variant="secondary" size="sm" className="touch-target">
            {t('desk.landingBack')}
          </LinkButton>
        }
      />
      <ApprovalsList
        initial={queue}
        initialSummary={summary}
        filters={filters}
        filtered
        filteredNote={t('desk.landingDone')}
        viewerRole={viewerRole}
        landing
      />
    </div>
  );
}
